import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MoreVertical, Search, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/_dashboard/messages")({
  head: ({ match }) => ({
    meta: [{ title: pageTitle(match.context, "messages") }],
  }),
  component: MessagesPage,
});

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
    lastMessage: "Hey! How's the puzzle collection coming along?",
    lastMessageTime: "2:30 PM",
    unreadCount: 2,
    isOnline: true,
  },
  {
    id: "2",
    name: "Bob Smith",
    lastMessage: "I have a new puzzle to trade if you're interested",
    lastMessageTime: "1:45 PM",
    unreadCount: 0,
    isOnline: false,
  },
  {
    id: "3",
    name: "Carol Davis",
    lastMessage: "Thanks for the trade! The puzzle is amazing",
    lastMessageTime: "Yesterday",
    unreadCount: 0,
    isOnline: true,
  },
  {
    id: "4",
    name: "David Wilson",
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

// One conversation as an open divided row: avatar (with presence dot), the
// name bolder when unread, the last message in body color when unread and
// muted otherwise, and a right column with the muted timestamp over a small
// primary unread-count pill.
function ConversationRow({
  user,
  selected,
  isLast,
  onSelect,
}: {
  user: User;
  selected: boolean;
  isLast: boolean;
  onSelect: () => void;
}) {
  const unread = user.unreadCount > 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 px-2 py-3 text-left transition-colors",
        !isLast && "border-b",
        selected ? "bg-muted/60" : "hover:bg-muted/40",
      )}
    >
      <div className="relative shrink-0">
        <Avatar className="size-10">
          {user.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
          <AvatarFallback>
            {user.name
              .split(" ")
              .map((n) => n[0])
              .join("")}
          </AvatarFallback>
        </Avatar>
        {user.isOnline && (
          <div className="border-background absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 bg-green-500" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-sm",
            unread ? "font-bold" : "font-semibold",
          )}
        >
          {user.name}
        </p>
        <p
          className={cn(
            "truncate text-sm",
            unread ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {user.lastMessage}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5 self-start pt-0.5">
        <span className="text-muted-foreground text-xs whitespace-nowrap">
          {user.lastMessageTime}
        </span>
        {unread && (
          <span className="bg-primary text-primary-foreground inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold">
            {user.unreadCount}
          </span>
        )}
      </div>
    </button>
  );
}

function MessagesPage() {
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
    <div className="flex h-[calc(100vh-14rem)] min-h-[420px] gap-6">
      {/* Conversation list — open rows on the ground, no boxed card */}
      <div className="flex w-full max-w-xs flex-col sm:w-80">
        <div className="relative mb-2">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input placeholder="Search users..." className="pl-9" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {mockUsers.map((user, index) => (
            <ConversationRow
              key={user.id}
              user={user}
              selected={selectedUser?.id === user.id}
              isLast={index === mockUsers.length - 1}
              onSelect={() => setSelectedUser(user)}
            />
          ))}
        </div>
      </div>

      {/* Thread — separated by a hairline, not a card */}
      <div className="flex min-w-0 flex-1 flex-col border-l pl-6">
        {selectedUser ? (
          <>
            {/* Thread header */}
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Avatar className="size-10">
                    {selectedUser.avatar && (
                      <AvatarImage
                        src={selectedUser.avatar}
                        alt={selectedUser.name}
                      />
                    )}
                    <AvatarFallback>
                      {selectedUser.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")}
                    </AvatarFallback>
                  </Avatar>
                  {selectedUser.isOnline && (
                    <div className="border-background absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 bg-green-500" />
                  )}
                </div>
                <div>
                  <p className="font-heading text-base font-bold">
                    {selectedUser.name}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {selectedUser.isOnline ? "Online" : "Offline"}
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="sm">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </div>

            {/* Messages */}
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex",
                    message.isFromMe ? "justify-end" : "justify-start",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-xs rounded-lg px-4 py-2 lg:max-w-md",
                      message.isFromMe
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted",
                    )}
                  >
                    <p className="text-sm">{message.content}</p>
                    <p
                      className={cn(
                        "mt-1 text-xs",
                        message.isFromMe
                          ? "text-primary-foreground/70"
                          : "text-muted-foreground",
                      )}
                    >
                      {message.timestamp}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Composer */}
            <div className="border-t pt-3">
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
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center">
              <div className="mb-2 text-[34px] leading-none" aria-hidden>
                🧩
              </div>
              <h3 className="font-heading text-lg font-bold">
                Select a conversation
              </h3>
              <p className="text-muted-foreground text-sm">
                Choose a user from the sidebar to start messaging
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
