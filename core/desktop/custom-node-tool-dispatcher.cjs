const GRAPH_STORES = Object.freeze(["tl_runtime_nodes", "tl_runtime_dependencies", "tl_channels"]);
const SAFE_MUTATION_TOOLS = Object.freeze(["createNode", "connectNodes", "disconnectNodes", "deleteNode", "duplicateNode", "moveNode", "renameNode", "updateNodeConfig", "fixGraph"]);

const errorWithCode = (message, code) => Object.assign(new Error(message), { code });
const clone = (value) => JSON.parse(JSON.stringify(value));

// Core-owned, deliberately small tool dispatcher. It never exposes SQLite
// handles/paths and has no mutation operation; sandbox code can only request
// a workspace-scoped graph snapshot after the broker grants that capability.
class CustomNodeToolDispatcher {
  constructor({ persistence = null } = {}) {
    this.persistence = persistence;
  }

  async dispatch({ tool = "", arguments: args = {}, request = {} } = {}) {
    if (tool === "runtimeGraph.read") return this.readRuntimeGraph(request);
    if (tool === "runtimeGraph.preflight") return this.preflightRuntimeGraph(request, args);
    throw errorWithCode("Custom Node tool non disponibile.", "CUSTOM_NODE_TOOL_UNAVAILABLE");
  }

  async readRuntimeGraph(request = {}) {
    const workspaceId = String(request.context?.workspaceId || "").trim();
    if (!workspaceId) throw errorWithCode("Il tool runtimeGraph.read richiede un workspace scoped.", "CUSTOM_NODE_TOOL_SCOPE_REQUIRED");
    if (!this.persistence?.readDevelopmentRecords) throw errorWithCode("Persistenza runtime non disponibile.", "CUSTOM_NODE_TOOL_PERSISTENCE_UNAVAILABLE");
    const records = await Promise.all(GRAPH_STORES.map((storeName) => this.persistence.readDevelopmentRecords({ storeName, workspaceId })));
    const [nodes, dependencies, channels] = records.map((items) => Array.isArray(items) ? clone(items) : []);
    return {
      mode: "read",
      workspaceId,
      graph: { nodes, dependencies, channels },
      provenance: { source: "tl-core", stores: [...GRAPH_STORES], workspaceScoped: true },
      limitations: []
    };
  }

  async preflightRuntimeGraph(request = {}, args = {}) {
    const workspaceId = String(request.context?.workspaceId || "").trim();
    if (!workspaceId) throw errorWithCode("Il tool runtimeGraph.preflight richiede un workspace scoped.", "CUSTOM_NODE_TOOL_SCOPE_REQUIRED");
    const action = String(args.action || "").trim();
    if (!SAFE_MUTATION_TOOLS.includes(action)) throw errorWithCode("Il preflight richiede un tool mutativo TL registrato.", "CUSTOM_NODE_PREFLIGHT_ACTION_INVALID");
    const proposedAction = { tool: action, arguments: clone(args.arguments && typeof args.arguments === "object" ? args.arguments : {}) };
    const checks = ["Workspace scope bound to the active sandbox request.", "No write was performed.", "A trusted TL surface must revalidate and confirm before safe-executor apply."];
    const warnings = [];
    if (action === "deleteNode") {
      const nodeId = String(proposedAction.arguments.nodeId || "").trim();
      if (!nodeId) throw errorWithCode("deleteNode preflight richiede arguments.nodeId.", "CUSTOM_NODE_PREFLIGHT_NODE_REQUIRED");
      if (!this.persistence?.readDevelopmentRecords) throw errorWithCode("Persistenza runtime non disponibile.", "CUSTOM_NODE_TOOL_PERSISTENCE_UNAVAILABLE");
      const dependencies = await this.persistence.readDevelopmentRecords({ storeName: "tl_runtime_dependencies", workspaceId });
      const affectedDependencies = (Array.isArray(dependencies) ? dependencies : []).filter((dependency) => dependency.sourceNodeId === nodeId || dependency.targetNodeId === nodeId).map(clone);
      if (affectedDependencies.length) warnings.push(`Deleting this node would remove ${affectedDependencies.length} dependency record(s).`);
      proposedAction.affectedDependencies = affectedDependencies;
    }
    return {
      mode: "preflight",
      workspaceId,
      executable: false,
      proposedAction,
      checks,
      warnings,
      limitations: ["Custom Node packages cannot mutate the runtime graph. Use the registered safe executor from a trusted TL surface."],
      provenance: { source: "tl-core", workspaceScoped: true }
    };
  }
}

module.exports = { GRAPH_STORES, SAFE_MUTATION_TOOLS, CustomNodeToolDispatcher };
