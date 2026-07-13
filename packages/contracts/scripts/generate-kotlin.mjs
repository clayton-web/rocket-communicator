import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const contractsRoot = path.resolve(root, '..');
const generatorCli = path.join(contractsRoot, 'node_modules', '.bin', 'openapi-generator-cli');

execFileSync(
  generatorCli,
  [
    'generate',
    '-i',
    'dist/openapi.bundled.yaml',
    '-g',
    'kotlin',
    '-o',
    'generated/kotlin',
    '--global-property',
    'models,modelTests=false,apis=false,apiTests=false,supportingFiles=false',
    '--additional-properties',
    'dateLibrary=string,serializableModel=true,library=jvm-okhttp4,serializationLibrary=moshi,modelPackage=com.aicommunication.assistant.contracts.models',
  ],
  { cwd: contractsRoot, stdio: 'inherit' },
);
