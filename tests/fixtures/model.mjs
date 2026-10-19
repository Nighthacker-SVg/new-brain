// Deterministic HTTP fixture for integration tests, never a production fallback.
import http from "node:http";
const files = [
  {
    path: "invoice.mjs",
    content:
      "export function total(items){return items.reduce((sum,item)=>sum+item.price*item.quantity,0);}\n",
  },
  {
    path: "invoice.test.mjs",
    content:
      "import{test}from'node:test';import assert from'node:assert/strict';import{total}from'./invoice.mjs';test('invoice total',()=>assert.equal(total([{price:20,quantity:2},{price:5,quantity:1}]),45));test('empty invoice',()=>assert.equal(total([]),0));\n",
  },
  {
    path: "index.html",
    content:
      "<!doctype html><html><head><title>Invoice preview</title></head><body><h1>Invoice preview</h1><p>Fixture-generated static preview. Actual calculator checks are separate.</p></body></html>",
  },
];
http
  .createServer(async (req, res) => {
    if (req.url === "/health") {
      res.end("ok");
      return;
    }
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404);
      res.end();
      return;
    }
    let input = "";
    for await (const chunk of req) {
      input += chunk;
      if (input.length > 500000) {
        res.writeHead(413);
        res.end();
        return;
      }
    }
    try {
      const body = JSON.parse(input),
        system = body.messages
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n");
      let content;
      if (system.includes("questions:string[]"))
        content = JSON.stringify({
          summary:
            "Implement an invoice calculator and verify it with executable tests.",
          questions: [],
          tasks: [
            { title: "Implement calculation", agentName: "Theo" },
            { title: "Verify totals", agentName: "Leo" },
          ],
          acceptanceCriteria: [
            "Invoice totals are correct.",
            "An empty invoice totals zero.",
          ],
        });
      else if (system.includes("files:[{path:string,content:string}]"))
        content = JSON.stringify({
          summary: "Candidate calculator with tests and a static preview.",
          files,
          runtime: "node",
          testCommand: "node-test",
        });
      else
        content =
          "EVIDENCE: This is the deterministic integration-test model. I can discuss the current recorded project; no action occurs from chat alone.";
      const response = {
        id: "fixture",
        model: "fixture-model",
        choices: [
          { message: { role: "assistant", content }, finish_reason: "stop" },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 150,
          total_tokens: 250,
        },
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    } catch {
      res.writeHead(400);
      res.end("{}");
    }
  })
  .listen(11434, "0.0.0.0");
