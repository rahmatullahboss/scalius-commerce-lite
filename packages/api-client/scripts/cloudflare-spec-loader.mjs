const CLOUDFLARE_RUNTIME_STUB = `
export class DurableObject {
  constructor(state, env) {
    this.ctx = state;
    this.state = state;
    this.env = env;
  }
}

export class WorkerEntrypoint {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}

export class WorkflowEntrypoint extends WorkerEntrypoint {}
export class RpcTarget {}
export class EmailMessage {}
export const env = {};
export const exports = {};
export function connect() {
  throw new Error("Cloudflare sockets are unavailable during OpenAPI generation");
}
`;

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("cloudflare:")) {
    console.warn(`[openapi-loader] stubbing ${specifier}`);
    return {
      url: `data:text/javascript,${encodeURIComponent(CLOUDFLARE_RUNTIME_STUB)}`,
      shortCircuit: true,
    };
  }

  return nextResolve(specifier, context);
}
