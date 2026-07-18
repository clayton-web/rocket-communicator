/**
 * Shared OpenAPI Generator CLI arguments for Kotlin model generation (D047).
 * Keep host (`generate-kotlin.mjs`) and Docker JDK (`generate-kotlin-docker.mjs`) paths in sync.
 */
export const KOTLIN_GENERATE_ARGS = [
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
];
