"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MoreVertical, Search, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface User {
  id: string;
  name: string;
  avatar?: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  isOnline: boolean;
}

interface Message {
  id: string;
  content: string;
  timestamp: string;
  isFromMe: boolean;
}

const mockUsers: User[] = [
  {
    id: "1",
    name: "Alice Johnson",
    avatar: "/avatars/alice.jpg",
    lastMessage: "Hey! How's the puzzle collection coming along?",
    lastMessageTime: "2:30 PM",
    unreadCount: 2,
    isOnline: true,
  },
  {
    id: "2",
    name: "Bob Smith",
    avatar: "/avatars/bob.jpg",
    lastMessage: "I have a new puzzle to trade if you're interested",
    lastMessageTime: "1:45 PM",
    unreadCount: 0,
    isOnline: false,
  },
  {
    id: "3",
    name: "Carol Davis",
    avatar: "/avatars/carol.jpg",
    lastMessage: "Thanks for the trade! The puzzle is amazing",
    lastMessageTime: "Yesterday",
    unreadCount: 0,
    isOnline: true,
  },
  {
    id: "4",
    name: "David Wilson",
    avatar: "/avatars/david.jpg",
    lastMessage: "Are you still looking for that specific puzzle?",
    lastMessageTime: "Yesterday",
    unreadCount: 1,
    isOnline: false,
  },
];

const mockMessages: Message[] = [
  {
    id: "1",
    content: "Hey! How's the puzzle collection coming along?",
    timestamp: "2:30 PM",
    isFromMe: false,
  },
  {
    id: "2",
    content: "It's going great! I just added a new 1000-piece landscape puzzle",
    timestamp: "2:32 PM",
    isFromMe: true,
  },
  {
    id: "3",
    content: "That sounds amazing! What brand is it?",
    timestamp: "2:33 PM",
    isFromMe: false,
  },
  {
    id: "4",
    content: "It's from Ravensburger. The quality is incredible",
    timestamp: "2:35 PM",
    isFromMe: true,
  },
];

export default function MessagesPage() {
  const [selectedUser, setSelectedUser] = useState<User | null>(mockUsers[0]);
  const [messages, setMessages] = useState<Message[]>(mockMessages);
  const [newMessage, setNewMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = () => {
    if (!newMessage.trim() || !selectedUser) return;

    const message: Message = {
      id: Date.now().toString(),
      content: newMessage,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      isFromMe: true,
    };

    setMessages([...messages, message]);
    setNewMessage("");
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="container mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Messages</h1>
          <p className="text-muted-foreground">
            Connect with other puzzle enthusiasts
          </p>
        </div>
      </div>

      <div className="flex h-[calc(100vh-12rem)] gap-4">
        {/* Sidebar - User List */}
        <Card className="w-80 flex-shrink-0">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search users..." className="pl-9" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0 max-h-full overflow-y-auto">
            <div className="space-y-1">
              {mockUsers.map((user) => (
                <div
                  key={user.id}
                  className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50 transition-colors ${
                    selectedUser?.id === user.id ? "bg-muted" : ""
                  }`}
                  onClick={() => setSelectedUser(user)}
                >
                  <div className="relative">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={user.avatar} alt={user.name} />
                      <AvatarFallback>
                        {user.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")}
                      </AvatarFallback>
                    </Avatar>
                    {user.isOnline && (
                      <div className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-green-500 border-2 border-background" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-sm truncate">
                        {user.name}
                      </p>
                      <span className="text-xs text-muted-foreground">
                        {user.lastMessageTime}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {user.lastMessage}
                    </p>
                  </div>
                  {user.unreadCount > 0 && (
                    <Badge variant="secondary" className="ml-auto">
                      {user.unreadCount}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Main Chat Area */}
        <Card className="flex-1 flex flex-col">
          {selectedUser ? (
            <>
              {/* Chat Header */}
              <CardHeader className="pb-3 border-b">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Avatar className="h-10 w-10">
                        <AvatarImage
                          src={selectedUser.avatar}
                          alt={selectedUser.name}
                        />
                        <AvatarFallback>
                          {selectedUser.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")}
                        </AvatarFallback>
                      </Avatar>
                      {selectedUser.isOnline && (
                        <div className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-green-500 border-2 border-background" />
                      )}
                    </div>
                    <div>
                      <CardTitle className="text-lg">
                        {selectedUser.name}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {selectedUser.isOnline ? "Online" : "Offline"}
                      </p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>

              {/* Messages */}
              <CardContent className="flex-1 p-4 overflow-y-auto space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.isFromMe ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                        message.isFromMe
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      <p className="text-sm">{message.content}</p>
                      <p
                        className={`text-xs mt-1 ${
                          message.isFromMe
                            ? "text-primary-foreground/70"
                            : "text-muted-foreground"
                        }`}
                      >
                        {message.timestamp}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </CardContent>

              {/* Message Input */}
              <div className="p-4 border-t">
                <div className="flex gap-2">
                  <Input
                    placeholder="Type a message..."
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyPress={handleKeyPress}
                    className="flex-1"
                  />
                  <Button
                    onClick={handleSendMessage}
                    disabled={!newMessage.trim()}
                    size="sm"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <h3 className="text-lg font-semibold">Select a conversation</h3>
                <p className="text-muted-foreground">
                  Choose a user from the sidebar to start messaging
                </p>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
