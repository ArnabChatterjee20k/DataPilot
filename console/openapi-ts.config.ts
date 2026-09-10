import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: './openapi.json',
  output: './src/lib/sdk',
  plugins: [
    {
      name: '@hey-api/client-fetch',
      runtimeConfigPath: './src/lib/sdk-runtime.ts',
    },
    '@hey-api/typescript',
    '@hey-api/sdk',
  ],
});
