import {Ollama} from 'ollama';
import { config } from './config';

const client = new Ollama({ host: config.OLLAMA_HOST });
export default client;