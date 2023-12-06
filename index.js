import axios from "axios";
import OpenAI from "openai";
import fs from "fs";
import FormData from "form-data";

const jiraBaseUrl = process.env.JIRA_BASE_URL;
const authHeader = process.env.JIRA_AUTH_HEADER;
const openai = new OpenAI({
  apiKey: process.env.OPEN_API_KEY,
});

export const handler = async (event) => {
  const body = JSON.parse(event.body);
  const commentFlag = body.flag;
  const systemPrompt = `
  Objective: Generate comprehensive Cypress test scripts for web automation based on the provided instructions.\n
  Requirements:\n
  Complete Scripts: Generate the entire Cypress test scripts, not just fragments or partial responses.\n
  Consider Given Data: Tailor the generated scripts to the specific data provided in the instructions.\n
  Avoid Unnecessary Text: Eliminate system-generated text that is irrelevant to the Cypress scripts.\n
  Precise Responses: Strive for the highest level of precision and accuracy in the generated scripts.\n
  Cypress Scripts Only: Focus solely on generating Cypress test scripts, omitting any extraneous content.`;

  const promptForParentAttachments = `
  Read the html given above for web automation and generate the 
  cypress test scripts code for each and every step given after the html code.`;

  const promptForCommentPart = `
  Read the above web automation cypress test scripts and do the changes according to 
  instructions given below`;

  const storyId = body.id;
  console.log(`The storyId is ${storyId} and flag is ${commentFlag}.`);

  const response = await getJiraStoryMetaData(storyId);
  const comments = response.fields.comment.comments;
  const attachments = response.fields.attachment;
  const noOfAttachments = attachments.length;
  const storyKey = response.key;

  console.log(`storyMetaData is ${JSON.stringify(response)}`);
  console.log(`comments are ${JSON.stringify(comments)}`);
  console.log(`attachments are ${JSON.stringify(attachments)}`);
  console.log(`attachments count is ${noOfAttachments}`);
  console.log(`storyKey is ${storyKey}`);

  const outputFiles = [];

  if (!commentFlag) {
    console.log("parent prompt -> " + promptForParentAttachments);
    for (const attachment of attachments) {
      let description = response.fields.description;
      await startAttachmentProcess(
        description,
        attachment,
        promptForParentAttachments,
        outputFiles,
        systemPrompt
      );
    }
  } else {
    const latestComment = comments[comments.length - 1];
    promptForCommentPart += `\n ${latestComment.body}`;
    console.log("Comment promt -> " + promptForCommentPart);

    console.log(`Inside comment part systemPrompt is ${systemPrompt}`);
    for (let i = 0; i < noOfAttachments; i++) {
      if (
        !attachments[noOfAttachments - 1 - i].filename.endsWith(
          "testscripts.txt"
        )
      ) {
        const attachment = attachments[i];
        await startAttachmentProcess(
          "",
          attachment,
          promptForCommentPart,
          outputFiles,
          systemPrompt
        );
      } else {
        break;
      }
    }
  }

  await attachTestCasesToTask(storyKey, outputFiles);
  return {
    statusCode: 200,
    body: JSON.stringify(event),
  };
};

async function getJiraStoryMetaData(storyId) {
  const headers = {
    Authorization: authHeader,
    "Content-Type": "application/json",
  };
  const response = await axios.get(
    `${jiraBaseUrl}/rest/api/2/issue/${storyId}`,
    { headers }
  );
  console.log(`JIRA metadata response is \n ${JSON.stringify(response.data)}`);
  return response.data;
}

async function startAttachmentProcess(
  description,
  attachment,
  prompt,
  outputFiles,
  systemPrompt
) {
  const outputFile = `/tmp/${attachment.id}-testscripts.txt`;
  const testCases = await readAttachment(attachment.id);
  description += testCases;

  console.log(`outputFile is ${outputFile}`);
  console.log(`testCases are ${JSON.stringify(testCases)}`);
  console.log(`description is ${description}`);

  console.log(`systemPrompt is ${systemPrompt}`);
  console.log(`prompt is ${prompt}`);

  await generateTestScripts(description, outputFile, prompt, systemPrompt);
  outputFiles.push(outputFile);
  console.log("out put file paths \n " + outputFiles);
}

async function readAttachment(attachmentID) {
  const url = `${jiraBaseUrl}/rest/api/2/attachment/content/${attachmentID}?redirect=true`;
  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
    });
    return response.data;
  } catch (error) {
    console.error(error.message);
  }
}

async function generateTestScripts(
  description,
  outputFile,
  prompt,
  systemPrompt
) {
  const model = process.env.OPEN_API_MODEL;
  console.log(`model = ${model}.`);

  const stream = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "assistant",
        content: `This data that you have to read and analyse for further cyprss test scripts creation \n ${description}`,
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    stream: true,
  });

  console.log(`stream generated is \n ${stream}`);

  let buffer = Buffer.alloc(0);
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content || "";
    buffer = Buffer.concat([buffer, Buffer.from(text)]);
    process.stdout.write(text);
  }
  await fs.writeFileSync(outputFile, buffer);
}

async function attachTestCasesToTask(key, outputFile) {
  try {
    const formData = new FormData();
    for (const filePath of outputFile) {
      const fileStream = fs.createReadStream(filePath);
      formData.append("file", fileStream);
    }

    await axios.post(
      `${jiraBaseUrl}/rest/api/2/issue/${key}/attachments`,
      formData,
      {
        headers: {
          Authorization: authHeader,
          "Content-Type": "multipart/form-data",
          Accept: "application/json",
          "X-Atlassian-Token": "no-check",
        },
      }
    );

    console.log(
      `Response status: ${response.status} \n statusText: ${response.statusText}`
    );
    console.log(`Response post attachments ${JSON.stringify(response.data)}`);
  } catch (error) {
    console.error(error.message);
  }
}
