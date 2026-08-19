import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { conversations, messages } from "@workspace/db/schema";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

// GET /api/anthropic/conversations
router.get("/conversations", requireAuth, async (_req, res) => {
  const rows = await db.select().from(conversations).orderBy(desc(conversations.createdAt));
  res.json(rows.map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt })));
});

// POST /api/anthropic/conversations
router.post("/conversations", requireAuth, async (req, res) => {
  const { title } = req.body;
  if (!title) { res.status(400).json({ error: "title required" }); return; }
  const [conv] = await db.insert(conversations).values({ title }).returning();
  res.status(201).json({ id: conv.id, title: conv.title, createdAt: conv.createdAt, messages: [] });
});

// GET /api/anthropic/conversations/:id
router.get("/conversations/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  if (!conv) { res.status(404).json({ error: "Not found" }); return; }
  const msgs = await db.select().from(messages).where(eq(messages.conversationId, id));
  res.json({ id: conv.id, title: conv.title, createdAt: conv.createdAt, messages: msgs });
});

// DELETE /api/anthropic/conversations/:id
router.delete("/conversations/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(conversations).where(eq(conversations.id, id));
  res.status(204).send();
});

// POST /api/anthropic/conversations/:id/messages — SSE streaming
router.post("/conversations/:id/messages", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  if (!conv) { res.status(404).json({ error: "Not found" }); return; }

  const { content } = req.body;
  if (!content) { res.status(400).json({ error: "content required" }); return; }

  // Persist user message
  await db.insert(messages).values({ conversationId: id, role: "user", content });

  // Build message history for Claude
  const history = await db.select().from(messages).where(eq(messages.conversationId, id));
  const claudeMessages = history.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let fullResponse = "";

  try {
    const stream = anthropic.messages.stream({
      model: "claude-opus-4-5",
      max_tokens: 2048,
      system: "You are GESAIA, an expert business intelligence assistant specializing in financial analysis, KPI interpretation, and strategic consulting for Brazilian businesses. Answer in the same language the user writes (PT or EN). Be concise, data-driven, and actionable.",
      messages: claudeMessages,
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        const text = event.delta.text;
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ type: "text", text })}\n\n`);
      }
    }

    // Persist assistant message
    await db.insert(messages).values({ conversationId: id, role: "assistant", content: fullResponse });
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
  }

  res.end();
});

export default router;
