"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useSendSpeech } from "@/hooks/useSendSpeech";
import { Loader, Loader2, RefreshCcw } from "lucide-react";
import { ReloadIcon } from "@radix-ui/react-icons";
import Image from "next/image";

export default function QuestionsDropdown({
	meetingRoomId,
}: {
	meetingRoomId: string;
}) {
	const [questions, setQuestions] = React.useState<any>("");
	const { needQuestions } = useSendSpeech();
	const [loading, setLoading] = React.useState(false);

	function handleWhenEmpty() {
		const res = needQuestions(meetingRoomId, "empty").then((questions) => {
			const questionArray = Object.values(questions);
			setQuestions(questionArray);

			setLoading(false);
			console.log("test", questions, "along");
		});
	}

	function handleQuestionReq() {
		const res = needQuestions(meetingRoomId, "not").then((questions) => {
			const questionArray = Object.values(questions);
			setQuestions(questionArray);
			setLoading(false);
			console.log("questions", questions);
		});
	}
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="outline"
						className="text-black dark:text-white">
						Questions
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent className="w-96">
					<DropdownMenuLabel className="flex justify-between">
						<div>Questions</div>
						{questions !== "" ? (
							<div>
								{!loading ? (
									<div
										className="hover:cursor-pointer"
										title="Get new questions"
										onClick={() => {
											handleQuestionReq();
											setLoading(true);
										}}>
										<ReloadIcon></ReloadIcon>
									</div>
								) : (
									<div className="flex flex-col-reverse">
										<Image
											src="/icons/loading-circle.svg"
											alt="Loading..."
											width={35}
											height={35}
										/>{" "}
									</div>
								)}
							</div>
						) : (
							<></>
						)}
					</DropdownMenuLabel>
					<DropdownMenuSeparator />
					{questions === "" ? (
						<div className="flex justify-center p-10">
							{!loading ? (
								<Button
									variant="outline"
									onClick={() => {
										handleWhenEmpty();
										setLoading(true);
									}}>
									Generate Questions
								</Button>
							) : (
								<Image
									src="/icons/loading-circle.svg"
									alt="Loading..."
									width={50}
									height={50}
								/>
							)}
						</div>
					) : (
						<div className="">
							{questions.map(
								(question: string, index: number) => (
									<li
										className="p-0.5 px-2"
										key={index}>
										{question}
									</li>
								)
							)}
						</div>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</>
	);
}
