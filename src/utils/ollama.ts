import {Ollama} from 'ollama';
const client = new Ollama({ host: process.env.OLLAMA_HOST });
export default client;