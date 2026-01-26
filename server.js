// Sadə Node.js + Express backend-i: Asİm botunu OpenAI Assistants API-si ilə birləşdirir

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { AI_CONFIG } from "./config/ai.config.js";


dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// 1) Burada Assistants API üçün OpenAI müştərisini yaradırıq.
//    OPENAI_API_KEY dəyəri .env faylından oxunur (təhlükəsizlik üçün kodda saxlamırıq).

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 2) Sizin GPT Assistanta aid ID-ni buraya əlavə edin.
//    ChatGPT-də yaratdığınız Assistant səhifəsində "Assistant ID" göstərilir.
//    Məsələn: asst_XXXXXXXXXXXX

const ASIM_ASSISTANT_ID = process.env.ASIM_ASSISTANT_ID; // .env faylında saxlayın

// Assistants API cavablarından sənəd istinadlarını, fayl adlarını və sitatları silir.
function sanitizeReply(text) {
  if (!text) return "";
  return (
    text
      // OpenAI sənəd istinadları:  və oxşar
      .replace(/【[^】]*】/g, "")
      // Kvadrat mötərizədəki sitatlar: [1], [1:0], [1:0†file]
      .replace(/\[[0-9]+(?::[0-9]+)?[^\]]*\]/g, "")
      // Dairəvi mötərizədəki sitatlar: (1), (1:0), (1:0†file)
      .replace(/\([0-9]+(?::[0-9]+)?[^\)]*\)/g, "")
      // Bir neçə boşluğu tək boşluğa endirir
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

app.post("/api/asim-chat", async (req, res) => {
  const userMessage = req.body?.message ?? "";
  const threadId = req.body?.threadId ?? null;

  if (!userMessage) {
    return res.status(400).json({ error: "Mesaj boş ola bilməz" });
  }

  // Проверяем наличие переменных окружения
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const assistantId = ASIM_ASSISTANT_ID?.trim();

  if (!apiKey || !assistantId) {
    const missing = [];
    if (!apiKey) missing.push("OPENAI_API_KEY");
    if (!assistantId) missing.push("ASIM_ASSISTANT_ID");

    console.error(`Хəta: Aşağıdakı dəyişənlər təyin edilməyib: ${missing.join(", ")}`);
    return res.status(500).json({
      error: `Server düzgün qurulmayıb. .env faylında aşağıdakı dəyişənləri yoxlayın: ${missing.join(", ")}`,
    });
  }

  try {
    // Əgər thread ID varsa, mövcud thread-i istifadə edirik, yoxsa yenisini yaradırıq
    let thread;
    if (threadId) {
      thread = { id: threadId };
    } else {
      thread = await client.beta.threads.create();
    }

    await client.beta.threads.messages.create(thread.id, {
      role: "user",
      content: userMessage,
    });

    const run = await client.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: assistantId,
      temperature: AI_CONFIG?.temperature ?? 0.1,
      top_p: AI_CONFIG?.top_p ?? 1.0
    });

    if (run.status !== "completed") {
      return res.status(500).json({
        error: "Asİm cavabı tamamlamadı. Bir az sonra yenidən cəhd edin.",
      });
    }

    const messages = await client.beta.threads.messages.list(thread.id, {
      order: "desc",
      limit: 1,
    });

    const last = messages.data[0];
    let replyText = "";

    if (last && Array.isArray(last.content) && last.content.length > 0) {
      const textPart = last.content[0];
      if (textPart.type === "text") {
        replyText = textPart.text.value;
      }
    }

    if (!replyText) {
      replyText = "Hazırda cavab yarada bilmədim, zəhmət olmasa yenidən cəhd edin.";
    }

    // Thread ID-ni client-ə qaytarırıq ki, sonrakı mesajlar üçün eyni thread-i istifadə edə bilsin
    return res.json({ reply: sanitizeReply(replyText), threadId: thread.id });
  } catch (err) {
    console.error("Asİm API xətası:", err);
    return res.status(500).json({ error: "Asİm ilə əlaqə zamanı xəta baş verdi." });
  }
});

app.listen(port, () => {
  console.log(`Asan Imza veb serveri http://localhost:${port} ünvanında işləyir`);
});
