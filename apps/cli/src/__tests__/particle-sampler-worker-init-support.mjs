// Test-only initializer that never reports ready; parent must kill its process.
await new Promise(() => {});
