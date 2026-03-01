"use client";
import { useSendSpeech } from "@/hooks/useSendSpeech";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "./ui/button";
import PreviousQuestions from "./PreviousQuestions";
import Image from "next/image";
import useSpeechRecognition from "@/hooks/UseSpeechMock";
import { Badge } from "./ui/badge";
import { Mic, MicOff } from "lucide-react";

/** Parses seniority and topics embedded in the description by buildDescription(). */
function parseDescriptionMetadata(raw: string): {
description: string;
seniority: string;
topics: string[];
} {
const parts = raw?.split("\n\n---METADATA---\n") ?? [];
if (parts.length < 2) {
return { description: raw ?? "", seniority: "mid", topics: [] };
}
const description = parts[0].trim();
const meta = parts[1];
const seniorityMatch = meta.match(/Seniority:\s*(.+)/);
const topicsMatch = meta.match(/Topics:\s*(.+)/);
const seniority = seniorityMatch ? seniorityMatch[1].trim() : "mid";
const topics =
topicsMatch && topicsMatch[1].trim() !== "General"
? topicsMatch[1].split(",").map((t) => t.trim())
: [];
return { description, seniority, topics };
}

const QUESTIONS_PER_BATCH = 5;

export default function MockInterviewComp() {
const mockId = usePathname();
const [mockDetails, setMockDetails] = useState<any>();
const [questions, setQuestions] = useState<string[]>([]);
const { needQuestions } = useSendSpeech();
const [loading, setLoading] = useState(false);
const [previousQuestions, setPreviousQuestions] = useState<string[]>([]);
const [count, setCount] = useState(0);
const router = useRouter();
const [isMuted, setIsMuted] = useState(false);
const [totalAnswered, setTotalAnswered] = useState(0);

const {
hasRecognitionSupport,
isListening,
startListening,
stopListening,
text,
setText,
} = useSpeechRecognition(isMuted);
const { sendWS } = useSendSpeech();

const parsed = useMemo(
() => parseDescriptionMetadata(mockDetails?.description ?? ""),
[mockDetails?.description]
);

function handleWhenEmpty() {
startListening();
setLoading(true);
needQuestions(mockId, "empty")
.then((questions) => {
const questionArray = Object.values(questions);
setQuestions(questionArray);
setLoading(false);
setTimeout(() => {
speak(String(questionArray[0]));
}, 200);
})
.catch((error) => {
console.error("Error fetching questions:", error);
setLoading(false);
});
}

function handleQuestionReq() {
setLoading(true);
needQuestions(mockId, "not")
.then((questions) => {
const questionArray = Object.values(questions);
setQuestions(questionArray);
setLoading(false);
setCount(0);
})
.catch((error) => {
console.error("Error fetching questions:", error);
setLoading(false);
});
}

function handleNext() {
setIsMuted((prev) => !prev);
setIsMuted((prev) => !prev);

sendWS({
text: questions[count],
role: "interviewer",
meetingRoomId: mockId,
});
setTimeout(() => {
sendWS({ text, role: "interviewee", meetingRoomId: mockId });
}, 1000);
setText("");
setTotalAnswered((n) => n + 1);
if (count === QUESTIONS_PER_BATCH - 1) {
handleQuestionReq();
} else {
setCount((c) => c + 1);
}
setPreviousQuestions((prev) => [...prev, questions[count]]);

setTimeout(() => {
speak(questions[count + 1]);
}, 400);
}

async function getMockDetails() {
try {
const response = await fetch(
`https://interviewmate-atie.onrender.com/meetingD`,
{
method: "POST",
headers: {
"Content-Type": "application/json",
},
body: JSON.stringify({ meetingRoomId: mockId }),
}
);

if (!response.ok) {
throw new Error(`HTTP error! status: ${response.status}`);
}

const data = await response.json();
setMockDetails(data.meetingDetails);
} catch (error) {
console.error("Fetch error:", error);
}
}

useEffect(() => {
if (!hasRecognitionSupport) {
alert("Speech recognition is not supported in this browser.");
}
if (text !== "") {
setInterval(() => {
startListening();
}, 100);
}
getMockDetails();
}, []);

function speak(question: string) {
const utterance = new SpeechSynthesisUtterance(question);
const voices = speechSynthesis.getVoices();
utterance.voice = voices[3];
speechSynthesis.speak(utterance);
}

const seniorityLabel: Record<string, string> = {
intern: "Intern",
junior: "Junior",
mid: "Mid-Level",
senior: "Senior",
staff: "Staff / Principal",
};

return (
<div className="pt-20 px-10 sm:px-20 md:px-40 lg:px-20 xl:px-60 flex flex-col justify-between h-screen">
<div>
{/* Header */}
<div className="flex items-center justify-between pb-1">
<div className="text-4xl font-bold">Mock Interview</div>
{questions.length > 0 && (
<div className="text-sm text-muted-foreground">
Question{" "}
<span className="font-semibold text-foreground">
{count + 1}
</span>{" "}
/ {QUESTIONS_PER_BATCH}
{totalAnswered > 0 && (
<span className="ml-3">
✅ {totalAnswered} answered
</span>
)}
</div>
)}
</div>

{/* Metadata badges */}
<div className="flex flex-wrap items-center gap-2 mt-2 mb-4">
{parsed.seniority && parsed.seniority !== "mid" ? (
<Badge variant="secondary">
{seniorityLabel[parsed.seniority] ??
parsed.seniority}
</Badge>
) : null}
{parsed.topics.map((topic) => (
<Badge key={topic} variant="outline">
{topic}
</Badge>
))}
</div>

<div
className="text-base text-muted-foreground mb-4"
title={parsed.description}>
<span className="font-semibold text-foreground">
Description:
</span>{" "}
{parsed.description.length > 100
? `${parsed.description.slice(0, 100)}…`
: parsed.description}
</div>

<div className="flex h-96 lg:gap-10 lg:justify-between mt-5">
<div className="flex flex-col justify-center items-center w-full lg:w-2/3 rounded-lg gap-4">
<Image
alt="bot image"
src="/images/bot.png"
height={240}
width={240}
/>
{/* Mic status */}
<div className="flex items-center gap-2">
{isListening ? (
<>
<span className="relative flex h-3 w-3">
<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
<span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
</span>
<Mic size={16} className="text-green-500" />
<span className="text-sm text-green-500">
Listening…
</span>
</>
) : (
<>
<MicOff
size={16}
className="text-muted-foreground"
/>
<span className="text-sm text-muted-foreground">
Mic off
</span>
</>
)}
</div>
</div>
<div className="hidden lg:block w-1/3 h-80 rounded-lg">
<div className="font-bold mb-2">Previous Questions</div>
<PreviousQuestions
previousQuestions={previousQuestions}
/>
</div>
</div>

{/* Live transcript */}
{isListening && (
<div className="mt-4 rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-900 p-3">
<div className="text-xs font-semibold uppercase tracking-wide text-green-600 dark:text-green-400 mb-1">
Your answer (live transcript)
</div>
<div className="text-sm min-h-[2rem] text-foreground">
{text || (
<span className="italic text-muted-foreground">
Start speaking…
</span>
)}
</div>
</div>
)}

{/* Current question + action */}
<div className="flex justify-between items-start gap-4 mt-6">
<div className="flex-1">
<div className="font-bold mb-1">
{questions.length > 0
? `Question ${count + 1}:`
: "Ready to start?"}
</div>
<div
onClick={() => speak(questions[count])}
className="hover:cursor-pointer text-base leading-relaxed"
title="Click to hear the question again">
{questions[count]}
</div>
</div>
<Button
disabled={loading}
className={loading ? "px-10 shrink-0" : "shrink-0"}
onClick={() => {
questions.length === 0
? handleWhenEmpty()
: handleNext();
}}>
{!loading ? (
<>
{questions.length === 0
? "Generate Question"
: "Next Question"}
</>
) : (
<Image
src="/icons/loading-circle.svg"
alt="Loading..."
width={35}
height={35}
/>
)}
</Button>
</div>
</div>

<div className="flex justify-center mt-10 pb-3 space-x-4">
<Button
className="bg-red-500 text-white px-4 py-2"
onClick={() => {
router.push("/home");
stopListening();
}}>
End Interview
</Button>
</div>
</div>
);
}
