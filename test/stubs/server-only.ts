// `server-only` is a guard, not a dependency.
//
// Its main entry throws on import — that is its whole job, and it is how a
// server module announces itself if a Client Component ever pulls it in. Next
// never reaches that throw because it resolves the package through its
// `react-server` export condition, which is empty. Vitest has no such
// condition, so it gets the throwing entry and the suite dies at collection.
//
// Turning the `react-server` condition on globally would change how React
// itself resolves — much wider blast radius than this needs. So the guard is
// stubbed for tests only, and the modules under test ship exactly as written.
export {};
