#!/usr/bin/env python3
"""Trackers Lens Python POC worker. Protocol: newline-delimited JSON on stdin/stdout."""
import json
import os
import sys
import threading
import time
from tl_python_sdk import NodeContext, capabilities, execute as execute_node, node, node_definition

PROTOCOL_VERSION = "tl-python-worker/v1"
write_lock = threading.Lock()
active = {}

def send(payload):
    with write_lock:
        sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
        sys.stdout.flush()

@node("poc.text_transform", capabilities=["text.transform"])
def text_transform(_ctx, inputs):
    value = inputs.get("text")
    if not isinstance(value, str):
        raise ValueError("inputs.text must be a string")
    return {"text": value.strip().upper(), "length": len(value)}

@node("poc.delay", capabilities=["runtime.test.delay"])
def delay(ctx, inputs):
    seconds = float(inputs.get("seconds", 0))
    if seconds < 0 or seconds > 30:
        raise ValueError("seconds must be between 0 and 30")
    ticks = max(1, int(seconds * 20))
    for index in range(ticks):
        if ctx._cancel_event.wait(seconds / ticks):
            return {"cancelled": True}
        ctx.progress(((index + 1) / ticks) * 100)
    return {"seconds": seconds, "completed": True}

@node("poc.raise", capabilities=["runtime.test.exception"])
def raise_exception(_ctx, _inputs):
    raise RuntimeError("Requested Python POC exception")

@node("poc.crash", capabilities=["runtime.test.crash"])
def crash(_ctx, _inputs):
    os._exit(99)

OPERATION_IDS = {
    "text_transform": "poc.text_transform",
    "delay": "poc.delay",
    "raise": "poc.raise",
    "crash": "poc.crash",
}

def execute(message):
    execution_id = message.get("executionId", "")
    cancel_event = active[execution_id]
    inputs = message.get("inputs") or {}
    try:
        send({"type": "event", "executionId": execution_id, "kind": "started"})
        operation = str(message.get("operation", "text_transform"))
        node_id = OPERATION_IDS.get(operation, operation)
        ctx = NodeContext(
            execution_id=execution_id,
            context=message.get("context") or {},
            _cancel_event=cancel_event,
            _emit=lambda kind, **payload: send({"type": "event", "executionId": execution_id, "kind": kind, **payload}),
        )
        outputs = execute_node(node_id, ctx, inputs)
        if ctx.cancelled or outputs.pop("cancelled", False):
            send({"type": "result", "executionId": execution_id, "status": "cancelled", "outputs": {}, "diagnostics": [{"code": "EXECUTION_CANCELLED"}]})
            return
        ctx.log("Python POC task completed", nodeId=node_id)
        send({"type": "result", "executionId": execution_id, "status": "success", "outputs": outputs, "diagnostics": [], "provenance": {"runtime": "python", "protocolVersion": PROTOCOL_VERSION, "node": node_definition(node_id)}})
    except Exception as error:
        send({"type": "result", "executionId": execution_id, "status": "failed", "outputs": {}, "diagnostics": [{"code": "NODE_EXCEPTION", "message": str(error)}]})
    finally:
        active.pop(execution_id, None)

def main():
    send({"type": "ready", "protocolVersion": PROTOCOL_VERSION, "capabilities": capabilities()})
    for raw in sys.stdin:
        try:
            message = json.loads(raw)
            message_type = message.get("type")
            if message_type == "execute":
                execution_id = message.get("executionId", "")
                if not execution_id or execution_id in active:
                    send({"type": "result", "executionId": execution_id, "status": "failed", "diagnostics": [{"code": "INVALID_INPUT", "message": "executionId is required and must be unique"}]})
                    continue
                active[execution_id] = threading.Event()
                threading.Thread(target=execute, args=(message,), daemon=True).start()
            elif message_type == "cancel":
                event = active.get(message.get("executionId", ""))
                if event: event.set()
            elif message_type == "shutdown":
                for event in active.values(): event.set()
                send({"type": "shutdown"})
                return
        except Exception as error:
            send({"type": "protocol_error", "message": str(error)})

if __name__ == "__main__": main()
