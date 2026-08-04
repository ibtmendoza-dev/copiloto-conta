import fetch from 'node-fetch';

async function listModels() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GOOGLE_GENERATIVE_AI_API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();
  console.log(JSON.stringify(data.models.map(m => m.name), null, 2));
}

listModels();
