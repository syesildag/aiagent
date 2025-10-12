import { execSync } from 'child_process';
import path from 'path';

function run(cmd: string) {
  try {
    console.log(`$ ${cmd}`);
    execSync(cmd, { stdio: 'inherit', cwd: path.resolve(__dirname, '../../../') });
  } catch (err) {
    console.error(`Error running command: ${cmd}`);
    process.exit(1);
  }
}

console.log('Cleaning up existing aiagent images...');
try {
  run('docker rmi -f aiagent:latest');
} catch (err) {
  console.log('No existing aiagent:latest image to remove.');
}
try {
  run('docker rmi -f localhost:6000/aiagent:latest');
} catch (err) {
  console.log('No existing localhost:6000/aiagent:latest image to remove.');
}

console.log('Building Docker image...');
run('docker build -t aiagent .');

console.log('Tagging image for local registry (localhost:6000)...');
run('docker tag aiagent:latest localhost:6000/aiagent:latest');

console.log('Pushing image to local registry...');
run('docker push localhost:6000/aiagent:latest');

console.log('Build and push complete.');