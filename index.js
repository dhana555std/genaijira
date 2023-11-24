import axios from "axios";
import OpenAI from "openai";
import { promises as fs1 } from "fs";
import fs from "fs";

const baseUrl = `https://rushi0224.atlassian.net/rest/api/2/issue`;
const authHeader = process.env.BASIC_AUTH;
const openai = new OpenAI({
  apiKey: "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",
});

export const handler = async (event) => {
  console.log(`The input from the API Gateway is \n ${JSON.stringify(event)}`);
  const body = JSON.parse(event.body);
  console.log(`The request body is \n ${JSON.stringify(body)}`);

  const storyId = body.id;
  console.log(`The storyId is ${storyId}.`);

  const response = await getJiraStoryMetaData(storyId);
  const description = response.fields.description;
  const key = response.key;
  const projectKey = response.fields.project.key;

  console.log(`The key is ${key}.`);
  console.log(`The description is \n ${description}`);
  const outputFile = "/tmp/testcases.txt";

  await generateTestCases(description, outputFile);

  const fileContent = await fs1.readFile(outputFile, "utf8");
  console.log(
    `\nTest cases read from the file are as follows:- \n ${fileContent}`
  );

  await createSubTask(projectKey, key);

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

  const response = await axios.get(`${baseUrl}/${storyId}`, { headers });
  console.log(`JIRA metadata response is \n ${JSON.stringify(response.data)}`);
  return response.data;
}

async function generateTestCases(description, outputFile) {
  const fileStream = fs.createWriteStream(outputFile);

  const stream = await openai.chat.completions.create({
    model: "gpt-3.5-turbo-1106",
    messages: [
      {
        role: "user",
        content: `Generate maximum test cases for the following requirement. Provide positive and negative
    test cases. \n ${description}.`,
      },
    ],
    stream: true,
  });

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content || "";
    fileStream.write(text);
    process.stdout.write(text);
  }

  fileStream.end();
}

async function createSubTask(projectKey, parentKey) {
  console.log(`Inside the createSubTask method.`);
  console.log(
    `url is ${baseUrl}, parentKey is ${parentKey} and projectKey is ${projectKey}.`
  );
  try {
    const subtaskRequestBody = {
      fields: {
        project: {
          key: projectKey,
        },
        parent: {
          key: parentKey,
        },
        labels: ["Testcases", "GenAi", "Cypress"],
        summary: `TestCases for task with Key ${parentKey}}`,
        description: "Testcases generated for parent task are attached.",
        issuetype: {
          name: "Subtask",
        },
      },
    };

    const response = await axios.post(baseUrl, subtaskRequestBody, {
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
    });

    console.log("Response:", response.data);
  } catch (error) {
    console.error("Error:", error.message);
  }
}
