const express = require("express")
const { Server } = require("socket.io")
const { createServer } = require("http")
const cors = require("cors");
const { default: axios } = require("axios");
const { PrismaClient } = require("@prisma/client")
require('dotenv').config();

const prisma = new PrismaClient()

const port = 8000;

/**
 * Parses the structured metadata embedded by the frontend's buildDescription()
 * into the description field.
 * Format:
 *   <user description>
 *
 *   ---METADATA---
 *   Seniority: senior
 *   Topics: React, Node.js, System Design
 */
function parseDescriptionMetadata(raw) {
    if (!raw) return { description: "", seniority: "mid", topics: "General" };
    const parts = raw.split("\n\n---METADATA---\n");
    if (parts.length < 2) return { description: raw, seniority: "mid", topics: "General" };
    const description = parts[0].trim();
    const meta = parts[1];
    const seniorityMatch = meta.match(/Seniority:\s*(.+)/);
    const topicsMatch = meta.match(/Topics:\s*(.+)/);
    return {
        description,
        seniority: seniorityMatch ? seniorityMatch[1].trim() : "mid",
        topics: topicsMatch ? topicsMatch[1].trim() : "General",
    };
}

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true,
    },
});

app.use(
    cors({
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true,
    })
);

app.use(express.json())

app.get("/", (req, res) => {
    res.send("Hello World!");
});

app.post("/partialD", async (req, res) => {
    // Get the body from the request
    const body = req.body;

    // Extract userMail from the body
    const userMail = body.email; // Ensure this key matches the key used in your client-side code

    if (!userMail) {
        // Handle missing userMail
        return res.status(400).json({
            mess: "Email is required"
        });
    }

    const partialDetails = await prisma.meetingRoom.findMany({
        where: {
            users: {
                contains: userMail
            },
        }, select: {
            description: true,
            meetingId: true,
            id: true,
            users: true,
            dateAndTime: true
        }
    })

    // Respond with the userMail and a success message
    return res.json({
        partialDetails,
        message: "success"
    });
});

app.post("/meetingD", async (req, res) => {
    // Get the body from the request
    const body = req.body;

    // Extract userMail from the body
    const meetingId = body.meetingRoomId; // Ensure this key matches the key used in your client-side code

    if (!meetingId) {
        // Handle missing 
        return res.status(400).json({
            mess: "Id is required"
        });
    }

    const meetingDetails = await prisma.meetingRoom.findFirst({
        where: {
            meetingId
        }
    })

    return res.json({
        meetingDetails,
        message: "success"
    });
});

app.post("/setDescription", async (req, res) => {
    // Get the body from the request
    const body = req.body;

    // Extract userMail from the body
    const meetingId = body.meetingRoomId; // Ensure this key matches the key used in your client-side code
    const description = body.description;
    console.log("''''''''test''''''''''''''''''")
    console.log(meetingId, description)
    console.log("''''''''test''''''''''''''''''")
    try {
        const response = await prisma.meetingRoom.create({
            data: {
                meetingId, description
            }
        })


        console.log("''''''''test''''''''''''''''''")
        console.log(response)
        console.log("''''''''test''''''''''''''''''")

        return res.json(response)
    } catch (error) {
        // console.log("Error:", error)
        return res.json(error)
    }
})

async function test(body) {
    const data = await axios.post("http://localhost:8000/", { body })
    return data
}




io.on("connection", (socket) => {
    console.log("User Connected", socket.id);

    // room join using the meeting id
    socket.on("join-room", async ({ id, userMail }) => {
        try {
            const existingMeetingRoom = await prisma.meetingRoom.findFirst({
                where: {
                    meetingId: id
                }
            })

            if (!existingMeetingRoom) {
                const meetingRoom = await prisma.meetingRoom.create({
                    data: {
                        meetingId: id,
                        users: userMail

                    }
                })
            } else {
                const usersUL = existingMeetingRoom.users + ", " + userMail
                const updateUser = await prisma.meetingRoom.update({
                    where: {
                        meetingId: id
                    },
                    data: {
                        users: usersUL
                    }
                });
                console.log("''''''''''''''''''")
                console.log(updateUser)
                console.log("''''''''''''''''''")
            }

        } catch (error) {
            console.log(error)
        }
    });

    socket.on("message", async ({ meetingRoomId, text, role }) => {
        try {
            const convo = await prisma.meetingRoom.update({
                where: {
                    meetingId: meetingRoomId
                },
                data: {
                    conversation: {
                        create: {
                            role,
                            text
                        }
                    }
                },
                include: {
                    conversation: true
                }
            });

        } catch (error) {
            console.log("Error:", error.message)
        }

    });



    socket.on('need-questions', async (meetingRoomId) => {
        try {
            const conversation = await prisma.meetingRoom.findFirst({
                where: {
                    meetingId: meetingRoomId,
                },
                include: {
                    conversation: {
                        select: {
                            text: true,
                            role: true,
                        },
                    },
                },
            });

            const meta = parseDescriptionMetadata(conversation.description);
            const response = await axios.post("https://interviewmate.azurewebsites.net/new-questions", {
                description: meta.description,
                seniority: meta.seniority,
                topics: meta.topics,
                conversations: conversation.conversation
            });

            const questions = response.data;

            socket.emit('questions', questions);
        } catch (error) {
            console.log(error)
        }
    })


    socket.on('need-questions-empty', async (meetingRoomId) => {
        try {
            const room = await prisma.meetingRoom.findFirst({
                where: {
                    meetingId: meetingRoomId,
                }, select: {
                    description: true
                }
            });

            const meta = parseDescriptionMetadata(room.description);
            const response = await axios.post("https://interviewmate.azurewebsites.net/take-description", {
                description: meta.description,
                seniority: meta.seniority,
                topics: meta.topics,
            });

            const questions = response.data;

            socket.emit('questions', questions);
        } catch (error) {
            console.log(error)
        }
    })


    socket.on("need-analysis", async (meetingRoomId) => {
        try {
            const meetingRoom = await prisma.meetingRoom.findFirst({
                where: {
                    meetingId: meetingRoomId,
                }
            })

            if (meetingRoom.analysis === "") {

                const conversation = await prisma.meetingRoom.findFirst({
                    where: {
                        meetingId: meetingRoomId
                    },
                    select: {
                        description: true,
                        conversation: {
                            select: {
                                text: true,
                                role: true
                            }
                        }
                    }
                });

                if (!conversation) {
                    socket.emit("error", "Conversation not found");
                    console.log("error started")
                    return;
                }

                try {
                    const meta = parseDescriptionMetadata(conversation.description);
                    const res = await axios.post("https://interviewmate.azurewebsites.net/analyze", {
                        description: meta.description,
                        seniority: meta.seniority,
                        topics: meta.topics,
                        conversations: conversation.conversation
                    });
                    // Emit only the data part of the response

                    const analysis = JSON.stringify(res.data)
                    console.log(analysis)
                    const updateMeeting = await prisma.meetingRoom.update({
                        where: {
                            meetingId: meetingRoomId
                        }, data: {
                            analysis
                        }
                    })

                    console.log(updateMeeting)
                    // console.log(analysis)
                    socket.emit("analysis", updateMeeting);


                } catch (error) {
                    console.error("Error in analysis request:", error);
                    socket.emit("error", "Analysis request failed");
                }

            } else {
                socket.emit("analysis", meetingRoom)

            }
        } catch (error) {
            console.error("Error fetching conversation:", error);
            socket.emit("error", "Failed to fetch conversation");
        }
    });



    socket.on("disconnect", () => {
        console.log("User Disconnected", socket.id);
    });
});


server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

