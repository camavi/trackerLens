"""Minimal, capability-scoped SDK for Trackers Lens Python nodes.

It intentionally offers no persistence, filesystem, network or subprocess APIs.
TL Core remains the authority for those capabilities.
"""
from dataclasses import dataclass

_NODES = {}


def node(id, capabilities=()):
    """Register a pure Python handler accepting ``(ctx, inputs)``."""
    node_id = str(id or "").strip()
    if not node_id:
        raise ValueError("Python node id is required")

    def register(handler):
        _NODES[node_id] = {
            "id": node_id,
            "capabilities": tuple(sorted({str(item) for item in capabilities if item})),
            "handler": handler,
        }
        return handler
    return register


@dataclass
class NodeContext:
    execution_id: str
    context: dict
    _cancel_event: object
    _emit: object

    def log(self, message, **data):
        self._emit("log", message=str(message), data=data)

    def progress(self, value, **data):
        self._emit("progress", progress=max(0, min(100, float(value))), data=data)

    @property
    def cancelled(self):
        return bool(self._cancel_event.is_set())


def execute(node_id, ctx, inputs):
    definition = _NODES.get(str(node_id or ""))
    if not definition:
        raise ValueError("Unsupported Python node operation")
    outputs = definition["handler"](ctx, inputs or {})
    return outputs if isinstance(outputs, dict) else {"value": outputs}


def capabilities():
    return sorted({capability for definition in _NODES.values() for capability in definition["capabilities"]})


def node_definition(node_id):
    definition = _NODES.get(str(node_id or ""))
    return None if not definition else {"id": definition["id"], "capabilities": list(definition["capabilities"])}
