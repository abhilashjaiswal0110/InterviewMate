"""
InterviewMate AI API
====================
FastAPI service that replaces the legacy Azure-hosted endpoints with a richer,
deep-agent–style pipeline:

  POST /take-description   – generate initial questions from a job description
  POST /new-questions      – generate follow-up questions from live conversation
  POST /analyze            – multi-step analysis of the full interview session

New capabilities vs. the original:
  • Seniority-aware question difficulty (intern → staff)
  • Topic-specific question focus (React, System Design, etc.)
  • Persistent session memory stored per meeting in SQLite (no extra infra)
  • Deep-agent analysis: three specialised sub-agents produce partial reports,
    which are then synthesised by a final aggregator agent.
"""

from __future__ import annotations

import json
import os
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import openai
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY environment variable is not set.")

client = openai.OpenAI(api_key=OPENAI_API_KEY)

# ---------------------------------------------------------------------------
# Persistent session memory (SQLite – zero extra dependencies)
# ---------------------------------------------------------------------------
DB_PATH = Path(__file__).parent / "session_memory.db"


def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db() -> None:
    with _get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS session_memory (
                meeting_id TEXT PRIMARY KEY,
                summary    TEXT NOT NULL DEFAULT '',
                topics     TEXT NOT NULL DEFAULT '',
                seniority  TEXT NOT NULL DEFAULT 'mid',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.commit()


def load_memory(meeting_id: str) -> dict[str, str]:
    with _get_db() as conn:
        row = conn.execute(
            "SELECT summary, topics, seniority FROM session_memory WHERE meeting_id = ?",
            (meeting_id,),
        ).fetchone()
    if row:
        return {"summary": row["summary"], "topics": row["topics"], "seniority": row["seniority"]}
    return {"summary": "", "topics": "", "seniority": "mid"}


def save_memory(meeting_id: str, summary: str, topics: str, seniority: str) -> None:
    with _get_db() as conn:
        conn.execute(
            """
            INSERT INTO session_memory (meeting_id, summary, topics, seniority)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(meeting_id) DO UPDATE SET
                summary    = excluded.summary,
                topics     = excluded.topics,
                seniority  = excluded.seniority,
                updated_at = CURRENT_TIMESTAMP
            """,
            (meeting_id, summary, topics, seniority),
        )
        conn.commit()


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[type-arg]
    _init_db()
    yield


app = FastAPI(title="InterviewMate AI API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class ConvoTurn(BaseModel):
    role: str
    text: str


class DescriptionRequest(BaseModel):
    description: str
    seniority: str = "mid"
    topics: str = "General"
    meeting_id: str = ""


class ConversationRequest(BaseModel):
    description: str
    conversations: list[ConvoTurn]
    seniority: str = "mid"
    topics: str = "General"
    meeting_id: str = ""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SENIORITY_GUIDANCE: dict[str, str] = {
    "intern": (
        "Questions should be beginner-friendly: basic syntax, simple algorithms, "
        "introductory concepts, and internship-style projects."
    ),
    "junior": (
        "Questions should cover core fundamentals, simple data structures, "
        "REST API basics, and entry-level coding exercises."
    ),
    "mid": (
        "Questions should test solid understanding of core concepts, design patterns, "
        "debugging skills, and small system design scenarios."
    ),
    "senior": (
        "Questions should challenge deep expertise: distributed systems, performance "
        "optimisation, architecture decisions, and mentoring/leadership scenarios."
    ),
    "staff": (
        "Questions should focus on org-wide technical strategy, cross-team architecture, "
        "engineering culture, and highly complex distributed system design."
    ),
}


def _seniority_hint(seniority: str) -> str:
    return SENIORITY_GUIDANCE.get(seniority.lower(), SENIORITY_GUIDANCE["mid"])


def _topics_hint(topics: str) -> str:
    if not topics or topics.lower() == "general":
        return "Cover a broad range of software engineering topics."
    return f"Focus specifically on: {topics}."


def _chat(messages: list[dict[str, str]], model: str = "gpt-4o-mini") -> str:
    response = client.chat.completions.create(
        model=model,
        messages=messages,  # type: ignore[arg-type]
        temperature=0.7,
    )
    return response.choices[0].message.content or ""


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "InterviewMate AI API"}


@app.post("/take-description")
def take_description(req: DescriptionRequest) -> dict[str, str]:
    """
    Generate an initial set of 5 interview questions from a job description.
    Respects seniority level and technical topic focus.
    """
    seniority_hint = _seniority_hint(req.seniority)
    topics_hint = _topics_hint(req.topics)

    # Retrieve any persistent memory for this session
    memory = load_memory(req.meeting_id) if req.meeting_id else {"summary": ""}
    memory_context = (
        f"\n\nPrevious session memory:\n{memory['summary']}" if memory.get("summary") else ""
    )

    system_prompt = (
        "You are an expert technical interviewer. "
        "Your task is to generate exactly 5 interview questions as a JSON object "
        "with keys 'question_1' through 'question_5'. "
        "Return ONLY valid JSON – no markdown, no commentary."
    )

    user_prompt = (
        f"Job description / role context:\n{req.description}"
        f"{memory_context}\n\n"
        f"Seniority guidance: {seniority_hint}\n"
        f"Topic guidance: {topics_hint}\n\n"
        "Generate 5 interview questions appropriate for this candidate."
    )

    raw = _chat([{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}])

    try:
        questions = json.loads(raw)
    except json.JSONDecodeError:
        # Fallback: wrap in a dict if the model returned a plain list
        try:
            lst = json.loads(raw)
            if isinstance(lst, list):
                questions = {f"question_{i + 1}": q for i, q in enumerate(lst[:5])}
            else:
                raise ValueError("Unexpected response format")
        except Exception:
            raise HTTPException(status_code=500, detail=f"AI returned invalid JSON: {raw}")

    # Persist seniority + topics for this session
    if req.meeting_id:
        save_memory(req.meeting_id, "", req.topics, req.seniority)

    return questions


@app.post("/new-questions")
def new_questions(req: ConversationRequest) -> dict[str, str]:
    """
    Generate 5 follow-up questions based on the ongoing conversation transcript.
    Uses a two-step agent pipeline:
      1. Summariser agent – extracts key themes and weak areas from the conversation.
      2. Question generator agent – crafts targeted follow-up questions.
    """
    seniority_hint = _seniority_hint(req.seniority)
    topics_hint = _topics_hint(req.topics)

    # Build conversation transcript
    transcript = "\n".join(
        f"{turn.role.capitalize()}: {turn.text}" for turn in req.conversations[-30:]
    )

    memory = load_memory(req.meeting_id) if req.meeting_id else {"summary": ""}
    memory_context = (
        f"\n\nPrevious session summary:\n{memory['summary']}" if memory.get("summary") else ""
    )

    # --- Agent 1: Conversation analyser ---
    analyser_messages = [
        {
            "role": "system",
            "content": (
                "You are a conversation analyst. Given an interview transcript, "
                "identify: (1) topics covered so far, (2) areas where the candidate "
                "struggled or gave shallow answers, (3) topics not yet explored. "
                "Be concise – max 150 words."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Role context: {req.description}{memory_context}\n\n"
                f"Transcript:\n{transcript}"
            ),
        },
    ]
    analysis_summary = _chat(analyser_messages)

    # --- Agent 2: Question generator ---
    generator_messages = [
        {
            "role": "system",
            "content": (
                "You are an expert technical interviewer. Based on the interview analysis, "
                "generate exactly 5 follow-up questions as a JSON object with keys "
                "'question_1' through 'question_5'. "
                "Return ONLY valid JSON – no markdown, no commentary."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Role context: {req.description}\n\n"
                f"Seniority guidance: {seniority_hint}\n"
                f"Topic guidance: {topics_hint}\n\n"
                f"Interview analysis:\n{analysis_summary}\n\n"
                "Generate 5 targeted follow-up questions."
            ),
        },
    ]
    raw = _chat(generator_messages)

    try:
        questions = json.loads(raw)
    except json.JSONDecodeError:
        try:
            lst = json.loads(raw)
            if isinstance(lst, list):
                questions = {f"question_{i + 1}": q for i, q in enumerate(lst[:5])}
            else:
                raise ValueError
        except Exception:
            raise HTTPException(status_code=500, detail=f"AI returned invalid JSON: {raw}")

    # Update persistent memory with the latest analysis summary
    if req.meeting_id:
        save_memory(req.meeting_id, analysis_summary, req.topics, req.seniority)

    return questions


@app.post("/analyze")
def analyze(req: ConversationRequest) -> dict[str, Any]:
    """
    Deep-agent analysis of the full interview session.

    Three specialised sub-agents evaluate different dimensions independently,
    then a final aggregator synthesises a holistic report.

    Returns:
    {
      "technical_skills":      {"rating": "X/10", "comment": "..."},
      "communication_skills":  {"rating": "X/10", "comment": "..."},
      "cultural_fit":          {"rating": "X/10", "comment": "..."},
      "overall_rating":        {"rating": "X/10", "comment": "..."},
      "strengths":             ["...", "..."],
      "improvement_areas":     ["...", "..."],
      "hiring_recommendation": "..."
    }
    """
    transcript = "\n".join(
        f"{turn.role.capitalize()}: {turn.text}" for turn in req.conversations
    )
    seniority_hint = _seniority_hint(req.seniority)
    topics_hint = _topics_hint(req.topics)
    memory = load_memory(req.meeting_id) if req.meeting_id else {"summary": ""}

    context = (
        f"Role description: {req.description}\n"
        f"Seniority level: {req.seniority} – {seniority_hint}\n"
        f"Technical focus: {topics_hint}\n"
    )
    if memory.get("summary"):
        context += f"\nSession history:\n{memory['summary']}\n"
    context += f"\nFull transcript:\n{transcript}"

    def sub_agent(dimension: str, evaluation_instructions: str) -> dict[str, str]:
        messages = [
            {
                "role": "system",
                "content": (
                    f"You are a specialist evaluator focused on **{dimension}**. "
                    "Respond ONLY with a JSON object: "
                    '{"rating": "N/10", "comment": "one paragraph"}. '
                    "No markdown."
                ),
            },
            {
                "role": "user",
                "content": f"{context}\n\nEvaluation instructions:\n{evaluation_instructions}",
            },
        ]
        raw = _chat(messages)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"rating": "N/A", "comment": raw.strip()}

    # --- Three specialised sub-agents ---
    technical = sub_agent(
        "Technical Skills",
        (
            "Assess the candidate's technical depth, accuracy of answers, "
            "problem-solving approach, and familiarity with the specified topics. "
            "Consider the seniority level when calibrating the rating."
        ),
    )
    communication = sub_agent(
        "Communication Skills",
        (
            "Assess clarity of explanations, ability to structure thoughts, "
            "active listening, and professional language."
        ),
    )
    cultural_fit = sub_agent(
        "Cultural Fit",
        (
            "Assess alignment with collaborative values, adaptability, growth mindset, "
            "and enthusiasm for the role."
        ),
    )

    # --- Aggregator agent ---
    aggregator_messages = [
        {
            "role": "system",
            "content": (
                "You are a senior hiring manager. Based on three specialist evaluations, "
                "produce a holistic interview report as a JSON object with these exact keys: "
                '"technical_skills", "communication_skills", "cultural_fit", "overall_rating", '
                '"strengths" (array of 2-3 strings), "improvement_areas" (array of 2-3 strings), '
                '"hiring_recommendation" (string: "Strong Yes / Yes / Maybe / No"). '
                "Return ONLY valid JSON – no markdown."
            ),
        },
        {
            "role": "user",
            "content": (
                f"{context}\n\n"
                f"Technical evaluation:\n{json.dumps(technical)}\n\n"
                f"Communication evaluation:\n{json.dumps(communication)}\n\n"
                f"Cultural fit evaluation:\n{json.dumps(cultural_fit)}\n\n"
                "Synthesise these into a comprehensive final report."
            ),
        },
    ]
    raw_final = _chat(aggregator_messages, model="gpt-4o-mini")

    try:
        result = json.loads(raw_final)
    except json.JSONDecodeError:
        # Partial fallback – keep sub-agent results even if aggregator fails
        result = {
            "technical_skills": technical,
            "communication_skills": communication,
            "cultural_fit": cultural_fit,
            "overall_rating": {"rating": "N/A", "comment": "Aggregation failed."},
            "strengths": [],
            "improvement_areas": [],
            "hiring_recommendation": "N/A",
        }

    # Persist final summary
    if req.meeting_id:
        summary = (
            f"Technical: {technical.get('rating')} – {technical.get('comment', '')[:100]}\n"
            f"Communication: {communication.get('rating')} – {communication.get('comment', '')[:100]}\n"
            f"Cultural Fit: {cultural_fit.get('rating')} – {cultural_fit.get('comment', '')[:100]}"
        )
        save_memory(req.meeting_id, summary, req.topics, req.seniority)

    return result
