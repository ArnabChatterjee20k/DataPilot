### setting up
```
uv pip install -r pyproject.toml
```

### Generating sdk for the console(ui)
```bash
    npx @hey-api/openapi-ts -i http://localhost:8000/openapi.json -o ..\console\src\lib\sdk
```