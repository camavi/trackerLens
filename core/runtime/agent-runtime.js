// Trackers Lens Agent Runtime v1: tool registry, flow run planning, traces and safe fix suggestions.
window.TrackerLensAgentRuntime = (() => {
  const VERSION = "agent-runtime-v1";
  const RUN_LIMIT = 250;
  const runs = new Map();

  const nowIso = () => new Date().toISOString();
  const runtimeId = (prefix = "agent_run") =>
    `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const normalizeWorkspaceId = (workspaceId = "") =>
    String(workspaceId || (typeof currentWorkspaceId === "function" ? currentWorkspaceId() : "") || "workspace_global");

  const normalizeChannel = (value = "") => String(value || "runtime").trim() || "runtime";

  const nodeLabel = (node = {}) => node.label || node.name || node.metadata?.paletteLabel || node.id || "Node";

  const nodeKind = (node = {}) =>
    String(node.metadata?.subtype || node.metadata?.manifest?.subtype || node.subtype || node.type || "").toLowerCase();

  const nodePorts = (node = {}) => ({
    inputs: Array.isArray(node.inputs) ? node.inputs : node.metadata?.manifest?.inputs || [],
    outputs: Array.isArray(node.outputs) ? node.outputs : node.metadata?.manifest?.outputs || [],
  });

  const portName = (port = "") =>
    typeof port === "object" ? String(port.name || port.key || port.channel || port.id || "") : String(port || "");

  const portNames = (ports = []) => (Array.isArray(ports) ? ports : []).map(portName).filter(Boolean);

  const hasPort = (node = {}, side = "out", name = "") => {
    const normalized = String(name || "").trim();
    if (!normalized || normalized === "all") return true;
    const ports = nodePorts(node);
    return portNames(side === "in" ? ports.inputs : ports.outputs).includes(normalized);
  };

  const firstPort = (node = {}, side = "out", preferences = []) => {
    const ports = portNames(side === "in" ? nodePorts(node).inputs : nodePorts(node).outputs);
    return preferences.find((name) => ports.includes(name)) || ports[0] || "all";
  };

  const fixId = (parts = []) => `fix_${parts.filter(Boolean).join("_")}`.replace(/[^A-Za-z0-9_-]/g, "_");

  const nodeBySubtype = (nodes = [], subtypes = []) => {
    const wanted = new Set(subtypes.map((item) => String(item || "").toLowerCase()));
    return nodes.find((node) => wanted.has(nodeKind(node))) || null;
  };

  const nodeByLabel = (nodes = [], labels = []) => {
    const wanted = labels.map((item) => String(item || "").toLowerCase());
    return nodes.find((node) => wanted.some((label) => String(nodeLabel(node)).toLowerCase().includes(label))) || null;
  };

  const actionPreview = (action = {}) => {
    if (!action?.kind) return "No automatic change. Inspect the flow and decide manually.";
    if (action.kind === "delete-link") return `Delete invalid link ${action.dependencyId || action.connectionId || ""}.`;
    if (action.kind === "update-link-ports") return `Update link ports to ${action.sourcePort || "all"} -> ${action.targetPort || "all"}.`;
    if (action.kind === "create-link") return `Create link ${action.sourceLabel || action.sourceNodeId} -> ${action.targetLabel || action.targetNodeId} using ${action.sourcePort || "all"} -> ${action.targetPort || "all"}.`;
    if (action.kind === "create-agent-bridge") return `Create Agent Bridge after ${action.sourceLabel || action.sourceNodeId} and connect ${action.sourcePort || "agent_control"} -> agent_control.`;
    return "Apply safe runtime change.";
  };

  const makeFix = ({
    type = "inspect-runtime-issue",
    severity = "warning",
    problem = "",
    cause = "",
    actionText = "",
    risk = "low",
    safe = false,
    action = null,
    nodeId = "",
    dependencyId = "",
    connectionId = "",
    reason = "",
  } = {}) => ({
    id: fixId([type, nodeId, dependencyId, connectionId, action?.kind, action?.sourceNodeId, action?.targetNodeId, action?.sourcePort, action?.targetPort]),
    type,
    severity,
    nodeId,
    dependencyId,
    connectionId,
    problem: problem || reason || "Runtime issue detected.",
    cause: cause || reason || "The runtime graph validation reported an issue.",
    actionText: actionText || (action ? actionPreview(action) : "Inspect the item and correct it manually."),
    risk,
    safe: Boolean(safe && action?.kind),
    action,
    preview: actionPreview(action),
    reason: reason || problem || "",
  });

  const dedupeFixes = (fixes = []) => {
    const seen = new Set();
    return fixes.filter((fix) => {
      if (!fix?.id || seen.has(fix.id)) return false;
      seen.add(fix.id);
      return true;
    });
  };

  const buildSnapshot = async (workspaceId = "") => {
    const effectiveWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (!window.TrackerLensGraphEngine?.buildGraph) {
      throw new Error("TrackerLensGraphEngine is not available.");
    }
    return window.TrackerLensGraphEngine.buildGraph({
      filters: {
        workspaceId: effectiveWorkspaceId,
        channel: "all",
        type: "all",
        origin: "all",
        state: "all",
        activity: "all",
        eventType: "all",
        logLevel: "all",
        runId: "all",
      },
      includeConnections: true,
    });
  };

  const graphNodes = (snapshot = {}) => snapshot.graph?.nodes || snapshot.runtime?.runtimeNodes || [];
  const graphDependencies = (snapshot = {}) => snapshot.graph?.dependencies || snapshot.runtime?.runtimeDependencies || [];

  const incomingFor = (dependencies = [], nodeId = "") =>
    dependencies.filter((dependency) => dependency.targetNodeId === nodeId);

  const outgoingFor = (dependencies = [], nodeId = "") =>
    dependencies.filter((dependency) => dependency.sourceNodeId === nodeId);

  const isControlDependency = (dependency = {}) =>
    ["agent_control", "agent-control"].includes(normalizeChannel(dependency.channel || dependency.metadata?.sourcePort || dependency.metadata?.targetPort).toLowerCase());

  const rootNodes = (nodes = [], dependencies = []) =>
    nodes.filter((node) => !incomingFor(dependencies, node.id).filter((dependency) => !isControlDependency(dependency)).length);

  const leafNodes = (nodes = [], dependencies = []) =>
    nodes.filter((node) => !outgoingFor(dependencies, node.id).filter((dependency) => !isControlDependency(dependency)).length);

  const matchingEventForStep = (events = [], step = {}) =>
    events.find((event) =>
      (step.nodeId && (event.sourceNodeId === step.nodeId || event.targetNodeId === step.nodeId)) ||
      (step.channel && normalizeChannel(event.channel) === normalizeChannel(step.channel))
    ) || null;

  const createTraceStep = ({ node = {}, dependency = null, index = 0, status = "pending", message = "", events = [] } = {}) => {
    const ports = nodePorts(node);
    const channel = dependency ? normalizeChannel(dependency.channel || dependency.metadata?.sourcePort || "runtime") : "";
    const step = {
      id: runtimeId("agent_step"),
      index,
      nodeId: node.id || "",
      label: nodeLabel(node),
      type: node.type || "",
      subtype: nodeKind(node),
      status,
      channel,
      sourceNodeId: dependency?.sourceNodeId || "",
      targetNodeId: dependency?.targetNodeId || "",
      dependencyId: dependency?.id || "",
      connectionId: dependency?.connectionId || "",
      sourcePort: dependency?.metadata?.sourcePort || dependency?.sourcePort || channel || "",
      targetPort: dependency?.metadata?.targetPort || dependency?.targetPort || "",
      expectedInput: ports.inputs?.length ? ports.inputs : dependency?.metadata?.targetPort ? [dependency.metadata.targetPort] : [],
      expectedOutput: ports.outputs?.length ? ports.outputs : dependency?.metadata?.sourcePort ? [dependency.metadata.sourcePort] : [],
      message,
      startedAt: "",
      finishedAt: "",
      latencyMs: 0,
      lastEvent: null,
    };
    const lastEvent = matchingEventForStep(events, step);
    if (lastEvent) {
      step.lastEvent = {
        id: lastEvent.id || "",
        channel: lastEvent.channel || "",
        eventType: lastEvent.eventType || "",
        status: lastEvent.status || "",
        createdAt: lastEvent.createdAt || "",
        payload: lastEvent.payload,
      };
    }
    return step;
  };

  const orderedPlan = ({ nodes = [], dependencies = [], events = [], startNodeId = "" } = {}) => {
    const lookup = new Map(nodes.map((node) => [node.id, node]));
    const roots = startNodeId
      ? nodes.filter((node) => node.id === startNodeId)
      : rootNodes(nodes, dependencies);
    const visited = new Set();
    const steps = [];
    const queue = roots.map((node) => ({ node, dependency: null }));

    while (queue.length) {
      const current = queue.shift();
      if (!current.node?.id || visited.has(current.node.id)) continue;
      visited.add(current.node.id);
      steps.push(createTraceStep({
        node: current.node,
        dependency: current.dependency,
        events,
        index: steps.length + 1,
        status: "pending",
        message: "Ready for runtime execution.",
      }));
      outgoingFor(dependencies, current.node.id)
        .filter((dependency) => !isControlDependency(dependency))
        .forEach((dependency) => {
          const target = lookup.get(dependency.targetNodeId);
          if (target && !visited.has(target.id)) queue.push({ node: target, dependency });
        });
    }

    return {
      roots: roots.map((node) => node.id),
      steps,
      skippedNodeIds: nodes.map((node) => node.id).filter((id) => !visited.has(id)),
    };
  };

  const summarizeFlow = (snapshot = {}) => {
    const nodes = graphNodes(snapshot);
    const dependencies = graphDependencies(snapshot);
    const roots = rootNodes(nodes, dependencies);
    const leaves = leafNodes(nodes, dependencies);
    const agentNodes = nodes.filter((node) => node.type === "aiAgent" || node.metadata?.category === "ai-agents");
    return {
      workspaceId: snapshot.filters?.workspaceId || "",
      nodes: nodes.length,
      dependencies: dependencies.length,
      roots: roots.map((node) => ({ id: node.id, label: nodeLabel(node), type: node.type || "", subtype: nodeKind(node) })),
      leaves: leaves.map((node) => ({ id: node.id, label: nodeLabel(node), type: node.type || "", subtype: nodeKind(node) })),
      agentNodes: agentNodes.map((node) => ({ id: node.id, label: nodeLabel(node), type: node.type || "", subtype: nodeKind(node) })),
      validation: snapshot.validation || null,
      stats: snapshot.stats || {},
    };
  };

  const inspectFlow = async ({ workspaceId = "" } = {}) => {
    const snapshot = await buildSnapshot(workspaceId);
    return {
      version: VERSION,
      inspectedAt: nowIso(),
      summary: summarizeFlow(snapshot),
      issues: snapshot.validation?.issues || [],
    };
  };

  const inspectNode = async ({ workspaceId = "", nodeId = "" } = {}) => {
    if (!nodeId) throw new Error("nodeId is required.");
    const effectiveWorkspaceId = normalizeWorkspaceId(workspaceId);
    const inspected = await window.TrackerLensGraphEngine.inspectNode(nodeId, {
      workspaceId: effectiveWorkspaceId,
      channel: "all",
      type: "all",
      origin: "all",
      state: "all",
      activity: "all",
      eventType: "all",
      logLevel: "all",
      runId: "all",
    });
    return {
      version: VERSION,
      inspectedAt: nowIso(),
      node: inspected.node ? {
        id: inspected.node.id,
        label: nodeLabel(inspected.node),
        type: inspected.node.type || "",
        subtype: nodeKind(inspected.node),
        ports: nodePorts(inspected.node),
        status: inspected.node.status || inspected.node.runtime?.status || inspected.node.metadata?.runtimeStatus || "idle",
      } : null,
      dependencies: inspected.dependencies || [],
      recentEvents: (inspected.events || []).slice(0, 10),
      impact: inspected.impact || null,
    };
  };

  const readLogs = async ({ workspaceId = "", nodeId = "", runId = "", limit = 30 } = {}) => {
    const snapshot = await buildSnapshot(workspaceId);
    const events = snapshot.runtime?.events || [];
    const flowLogs = snapshot.runtime?.flowLogs || [];
    const filteredEvents = events
      .filter((event) => !nodeId || event.sourceNodeId === nodeId || event.targetNodeId === nodeId)
      .filter((event) => !runId || event.runId === runId || event.payload?.runId === runId || event.meta?.runId === runId)
      .slice(0, limit);
    const filteredLogs = flowLogs
      .filter((log) => !nodeId || log.nodeId === nodeId || log.sourceNodeId === nodeId || log.targetNodeId === nodeId)
      .filter((log) => !runId || log.runId === runId || log.context?.runId === runId)
      .slice(0, limit);
    return {
      version: VERSION,
      readAt: nowIso(),
      events: filteredEvents,
      flowLogs: filteredLogs,
    };
  };

  const suggestFixes = async ({ workspaceId = "", nodeId = "" } = {}) => {
    const snapshot = await buildSnapshot(workspaceId);
    const nodes = graphNodes(snapshot);
    const dependencies = graphDependencies(snapshot);
    const lookup = new Map(nodes.map((node) => [node.id, node]));
    const issues = [...(snapshot.validation?.issues || [])];
    const fixes = [];
    if (nodeId && !nodes.some((node) => node.id === nodeId)) {
      issues.push({ level: "error", type: "node", nodeId, message: "node not found" });
    }

    issues.slice(0, 24).forEach((issue) => {
      const dependency = dependencies.find((item) => item.id === issue.id || item.connectionId === issue.id) || null;
      const source = lookup.get(issue.sourceNodeId || dependency?.sourceNodeId || "");
      const target = lookup.get(issue.targetNodeId || dependency?.targetNodeId || "");
      const lowerMessage = String(issue.message || "").toLowerCase();
      const sourcePort = dependency?.metadata?.sourcePort || dependency?.sourcePort || dependency?.channel || "all";
      const targetPort = dependency?.metadata?.targetPort || dependency?.targetPort || "all";

      if (lowerMessage.includes("duplicate") && dependency) {
        fixes.push(makeFix({
          type: "remove-duplicate-link",
          severity: "warning",
          dependencyId: dependency.id || issue.id || "",
          connectionId: dependency.connectionId || "",
          problem: "Duplicate runtime link.",
          cause: "Two links point to the same source, target and channel. Runtime traversal can produce duplicated work.",
          actionText: "Remove this duplicated dependency and keep the first valid route.",
          risk: "low",
          safe: true,
          action: { kind: "delete-link", dependencyId: dependency.id || "", connectionId: dependency.connectionId || "" },
          reason: issue.message || "",
        }));
        return;
      }

      if ((lowerMessage.includes("missing source") || lowerMessage.includes("missing target")) && dependency) {
        fixes.push(makeFix({
          type: "remove-broken-link",
          severity: "error",
          dependencyId: dependency.id || issue.id || "",
          connectionId: dependency.connectionId || "",
          problem: lowerMessage.includes("missing source") ? "Link source node is missing." : "Link target node is missing.",
          cause: "The dependency references a node that is no longer present in this workspace.",
          actionText: "Delete the broken dependency so the runtime graph can validate again.",
          risk: "low",
          safe: true,
          action: { kind: "delete-link", dependencyId: dependency.id || "", connectionId: dependency.connectionId || "" },
          reason: issue.message || "",
        }));
        return;
      }

      if (dependency && source && target && (!hasPort(source, "out", sourcePort) || !hasPort(target, "in", targetPort))) {
        const nextSourcePort = firstPort(source, "out", [dependency.channel, "action", "task", "output", "raw"]);
        const nextTargetPort = firstPort(target, "in", [dependency.channel, "agent_control", "task", "input", "raw"]);
        fixes.push(makeFix({
          type: "repair-link-ports",
          severity: "error",
          nodeId: target.id,
          dependencyId: dependency.id || issue.id || "",
          connectionId: dependency.connectionId || "",
          problem: "Link port mapping is invalid.",
          cause: `The current ports ${sourcePort} -> ${targetPort} are not declared on the connected nodes.`,
          actionText: `Retarget the dependency to valid ports ${nextSourcePort} -> ${nextTargetPort}.`,
          risk: "medium",
          safe: Boolean(nextSourcePort && nextTargetPort),
          action: {
            kind: "update-link-ports",
            dependencyId: dependency.id || "",
            connectionId: dependency.connectionId || "",
            sourceNodeId: source.id,
            targetNodeId: target.id,
            sourceLabel: nodeLabel(source),
            targetLabel: nodeLabel(target),
            sourcePort: nextSourcePort,
            targetPort: nextTargetPort,
            channel: nextSourcePort === "all" ? (dependency.channel || "runtime") : nextSourcePort,
          },
          reason: issue.message || "",
        }));
        return;
      }

      fixes.push(makeFix({
        type: issue.type === "dependency" ? "inspect-runtime-link" : "inspect-runtime-issue",
        severity: issue.level || "warning",
        nodeId: issue.sourceNodeId || issue.targetNodeId || issue.nodeId || "",
        dependencyId: issue.id || "",
        problem: issue.message || "Runtime validation issue.",
        cause: "The graph engine detected a condition that needs review.",
        actionText: "Open the node or link inspector and correct the graph manually.",
        risk: "manual",
        safe: false,
        reason: issue.message || "",
      }));
    });

    dependencies.forEach((dependency) => {
      const source = lookup.get(dependency.sourceNodeId || "");
      const target = lookup.get(dependency.targetNodeId || "");
      if (!source || !target) return;
      const sourcePort = dependency.metadata?.sourcePort || dependency.sourcePort || dependency.channel || "all";
      const targetPort = dependency.metadata?.targetPort || dependency.targetPort || "all";
      const sourcePortOk = hasPort(source, "out", sourcePort);
      const targetPortOk = hasPort(target, "in", targetPort);
      if (sourcePortOk && targetPortOk) return;
      const nextSourcePort = firstPort(source, "out", [dependency.channel, "agent_control", "action", "task", "output", "raw"]);
      const nextTargetPort = firstPort(target, "in", [dependency.channel, "agent_control", "task", "input", "raw"]);
      fixes.push(makeFix({
        type: "repair-link-ports",
        severity: "error",
        nodeId: target.id,
        dependencyId: dependency.id || "",
        connectionId: dependency.connectionId || "",
        problem: "Link port mapping is invalid.",
        cause: `The dependency points to ${sourcePort} -> ${targetPort}, but at least one port is not declared on the connected nodes.`,
        actionText: `Retarget the dependency to valid ports ${nextSourcePort} -> ${nextTargetPort}.`,
        risk: "medium",
        safe: Boolean(nextSourcePort && nextTargetPort),
        action: {
          kind: "update-link-ports",
          dependencyId: dependency.id || "",
          connectionId: dependency.connectionId || "",
          sourceNodeId: source.id,
          targetNodeId: target.id,
          sourceLabel: nodeLabel(source),
          targetLabel: nodeLabel(target),
          sourcePort: nextSourcePort,
          targetPort: nextTargetPort,
          channel: nextSourcePort === "all" ? (dependency.channel || "runtime") : nextSourcePort,
        },
        reason: "Invalid dependency port mapping.",
      }));
    });

    nodes
      .filter((node) => (!incomingFor(dependencies, node.id).length && !outgoingFor(dependencies, node.id).length))
      .filter((node) => !nodeId || node.id === nodeId)
      .slice(0, 8)
      .forEach((node) => {
        fixes.push(makeFix({
          type: "inspect-isolated-node",
          severity: "warning",
          nodeId: node.id,
          problem: `Isolated node: ${nodeLabel(node)}.`,
          cause: "The node has no incoming or outgoing runtime dependencies.",
          actionText: "Focus the node and connect it intentionally, or delete it if it is not part of the flow.",
          risk: "manual",
          safe: false,
          action: { kind: "focus-node", nodeId: node.id },
          reason: "Node has no runtime dependencies.",
        }));
      });

    const agentNodes = nodes.filter((node) => node.type === "aiAgent" || node.metadata?.category === "ai-agents");
    const bridge = nodeBySubtype(nodes, ["agent-bridge"]) || nodeByLabel(nodes, ["agent bridge"]);
    agentNodes
      .filter((node) => nodeKind(node) !== "agent-bridge")
      .filter((node) => !nodeId || node.id === nodeId)
      .forEach((agent) => {
        const hasBridgeLink = bridge && dependencies.some((dependency) =>
          dependency.sourceNodeId === agent.id && dependency.targetNodeId === bridge.id
        );
        if (!bridge) {
          const sourcePort = firstPort(agent, "out", ["agent_control", "action", "output"]);
          fixes.push(makeFix({
            type: "agent-needs-bridge",
            severity: "warning",
            nodeId: agent.id,
            problem: `Agent node is not separated by Agent Bridge: ${nodeLabel(agent)}.`,
            cause: "Agentic flows should separate decision/control output from executable action flow.",
            actionText: "Insert an Agent Bridge from the palette and connect agent_control -> agent_control.",
            risk: "medium",
            safe: true,
            action: {
              kind: "create-agent-bridge",
              sourceNodeId: agent.id,
              sourceLabel: nodeLabel(agent),
              sourcePort,
              targetPort: "agent_control",
              channel: sourcePort === "agent_control" ? "agent_control" : sourcePort,
            },
            reason: "No Agent Bridge node exists in this workspace.",
          }));
        } else if (!hasBridgeLink) {
          const sourcePort = firstPort(agent, "out", ["agent_control", "action", "output"]);
          const targetPort = firstPort(bridge, "in", ["agent_control", "input"]);
          fixes.push(makeFix({
            type: "connect-agent-bridge",
            severity: "warning",
            nodeId: agent.id,
            problem: `Agent node is not connected to Agent Bridge: ${nodeLabel(agent)}.`,
            cause: "The runtime cannot clearly separate agent control from downstream actions.",
            actionText: `Create a control link from ${nodeLabel(agent)} to ${nodeLabel(bridge)}.`,
            risk: "low",
            safe: true,
            action: {
              kind: "create-link",
              sourceNodeId: agent.id,
              targetNodeId: bridge.id,
              sourceLabel: nodeLabel(agent),
              targetLabel: nodeLabel(bridge),
              sourcePort,
              targetPort,
              channel: sourcePort === "agent_control" ? "agent_control" : sourcePort,
            },
            reason: "Missing Agent Bridge control link.",
          }));
        }
      });

    const preview = nodes.find((node) => node.type === "devPreview" || nodeKind(node) === "preview" || String(nodeLabel(node)).toLowerCase().includes("preview"));
    if (preview && !incomingFor(dependencies, preview.id).length) {
      const leaves = leafNodes(nodes, dependencies).filter((node) => node.id !== preview.id && node.type !== "source");
      if (leaves.length === 1) {
        const sourcePort = firstPort(leaves[0], "out", ["raw", "output", "action"]);
        const targetPort = firstPort(preview, "in", ["raw", "input"]);
        fixes.push(makeFix({
          type: "connect-preview",
          severity: "warning",
          nodeId: preview.id,
          problem: "Preview node is not receiving runtime output.",
          cause: "The flow has one clear terminal node but no dependency into Preview.",
          actionText: `Connect ${nodeLabel(leaves[0])} to Preview for final inspection.`,
          risk: "low",
          safe: true,
          action: {
            kind: "create-link",
            sourceNodeId: leaves[0].id,
            targetNodeId: preview.id,
            sourceLabel: nodeLabel(leaves[0]),
            targetLabel: nodeLabel(preview),
            sourcePort,
            targetPort,
            channel: sourcePort === "all" ? "runtime" : sourcePort,
          },
          reason: "Preview has no incoming dependency.",
        }));
      } else {
        fixes.push(makeFix({
          type: "preview-unreachable",
          severity: "warning",
          nodeId: preview.id,
          problem: "Preview node is not receiving runtime output.",
          cause: "There is not a single safe terminal node to connect automatically.",
          actionText: "Choose the correct final node and connect it to Preview.",
          risk: "manual",
          safe: false,
          reason: "Preview has no incoming dependency.",
        }));
      }
    }

    const roots = rootNodes(nodes, dependencies).filter((node) => node.type !== "devPreview");
    if (!nodeId && roots.length > 1) {
      fixes.push(makeFix({
        type: "multiple-runtime-roots",
        severity: "info",
        problem: "Multiple runtime roots detected.",
        cause: `${roots.length} nodes can start independently, so trace order may not express one objective.`,
        actionText: "Add a single Flow In, Trigger, Task Node or Orchestrator root when the flow should behave as one pipeline.",
        risk: "manual",
        safe: false,
        reason: "Runtime graph has multiple roots.",
      }));
    }

    return {
      version: VERSION,
      suggestedAt: nowIso(),
      fixes: dedupeFixes(fixes).slice(0, 20),
      issueCount: issues.length,
    };
  };

  const storeRun = (run = {}) => {
    runs.set(run.runId, run);
    while (runs.size > RUN_LIMIT) {
      const first = runs.keys().next().value;
      runs.delete(first);
    }
    return run;
  };

  const emitRunEvent = async (workspaceId = "", channel = "", payload = {}, meta = {}) => {
    const bus = window.TrackerLensEventBus?.get?.(workspaceId);
    if (!bus?.emit) return null;
    return bus.emit(channel, payload, {
      workspaceId,
      eventType: meta.eventType || channel.replace(/\W+/g, "_"),
      status: meta.status || "ok",
      sourceNodeId: meta.sourceNodeId || "",
      meta: { agentRuntime: VERSION, ...(meta.meta || {}) },
    }).catch(() => null);
  };

  const runFlow = async ({ workspaceId = "", startNodeId = "", payload = {}, dryRun = true, mode = "" } = {}) => {
    const effectiveWorkspaceId = normalizeWorkspaceId(workspaceId);
    const requestedMode = String(mode || (dryRun ? "dry-run" : "trace-only")).trim() || "dry-run";
    const safeMode = ["dry-run", "simulate", "execute-controlled", "trace-only"].includes(requestedMode)
      ? requestedMode
      : "dry-run";
    const snapshot = await buildSnapshot(effectiveWorkspaceId);
    const nodes = graphNodes(snapshot);
    const dependencies = graphDependencies(snapshot);
    const events = snapshot.runtime?.events || [];
    const plan = orderedPlan({ nodes, dependencies, events, startNodeId });
    const run = {
      version: VERSION,
      runId: runtimeId("agent_run"),
      workspaceId: effectiveWorkspaceId,
      mode: safeMode,
      execution: safeMode === "execute-controlled" ? "not-executed-v1-trace-only" : "trace-only",
      status: snapshot.validation?.ok === false ? "blocked" : "completed",
      objective: payload?.objective || payload?.task || "Trackers Lens agent runtime run",
      input: payload,
      summary: {
        plannedSteps: plan.steps.length,
        skippedNodes: plan.skippedNodeIds.length,
        validationOk: snapshot.validation?.ok !== false,
      },
      trace: plan.steps.map((step) => ({
        ...step,
        status: snapshot.validation?.ok === false ? "blocked" : "completed",
        startedAt: nowIso(),
        finishedAt: nowIso(),
        message: safeMode === "simulate"
          ? "Simulation trace completed; no graph state was mutated."
          : safeMode === "execute-controlled"
            ? "Controlled execution requested; v1 recorded a trace only and did not execute node adapters."
            : safeMode === "trace-only"
              ? "Trace recorded; node execution adapters remain delegated to runtime worker."
              : "Dry-run trace completed.",
      })),
      validation: snapshot.validation,
      startedAt: nowIso(),
      finishedAt: nowIso(),
    };
    storeRun(run);
    await emitRunEvent(effectiveWorkspaceId, "agent.runtime.run.completed", {
      runId: run.runId,
      status: run.status,
      summary: run.summary,
    }, {
      eventType: "agent_runtime_run_completed",
      status: run.status === "blocked" ? "blocked" : "ok",
      sourceNodeId: startNodeId,
    });
    return run;
  };

  const listRuns = () => Array.from(runs.values()).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));

  const getRun = (runId = "") => runs.get(runId) || null;

  const tools = {
    inspectFlow: {
      name: "inspectFlow",
      description: "Inspect the current runtime graph, roots, leaves, agent nodes and validation issues.",
      mutates: false,
      run: inspectFlow,
    },
    runFlow: {
      name: "runFlow",
      description: "Create a safe execution trace for the runtime graph. v1 is dry-run/trace-first.",
      mutates: false,
      run: runFlow,
    },
    inspectNode: {
      name: "inspectNode",
      description: "Inspect a runtime node, its dependencies, events and impact.",
      mutates: false,
      run: inspectNode,
    },
    readLogs: {
      name: "readLogs",
      description: "Read recent runtime events and flow logs for a workspace, node or run.",
      mutates: false,
      run: readLogs,
    },
    suggestFixes: {
      name: "suggestFixes",
      description: "Return safe fix suggestions for validation issues, invalid ports, broken links and agentic flow structure.",
      mutates: false,
      run: suggestFixes,
    },
    listRuns: {
      name: "listRuns",
      description: "List recent Agent Runtime traces kept in memory.",
      mutates: false,
      run: async () => ({ version: VERSION, runs: listRuns() }),
    },
  };

  const callTool = async (name = "", args = {}) => {
    const tool = tools[name];
    if (!tool) throw new Error(`Unknown Agent Runtime tool: ${name}`);
    return tool.run(args || {});
  };

  return {
    VERSION,
    tools,
    callTool,
    inspectFlow,
    inspectNode,
    readLogs,
    runFlow,
    suggestFixes,
    listRuns,
    getRun,
  };
})();
