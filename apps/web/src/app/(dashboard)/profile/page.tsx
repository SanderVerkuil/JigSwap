"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useUser } from "@clerk/nextjs";
import { api } from "@jigswap/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import {
  ArrowRightLeft,
  Calendar,
  MapPin,
  Package,
  Pencil,
  Star,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

export default function ProfilePage() {
  const { user } = useUser();
  const t = useTranslations("profile");
  const [isEditing, setIsEditing] = useState(false);

  const userProfile = useQuery(api.users.getCurrentUser);
  const convexUser = useQuery(
    api.users.getUserByClerkId,
    user?.id ? { clerkId: user.id } : "skip",
  );
  const userStats = useQuery(
    api.users.getUserStats,
    convexUser?._id ? { userId: convexUser._id } : "skip",
  );

  if (!user || !userProfile) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">{t("loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-6">
      {/* Profile Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button
          variant="outline"
          onClick={() => setIsEditing(!isEditing)}
          className="flex items-center gap-2"
        >
          <Pencil className="h-4 w-4" />
          {isEditing ? t("cancel") : t("edit")}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Information */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  {user.firstName?.[0] ||
                    user.emailAddresses[0]?.emailAddress[0] ||
                    "U"}
                </div>
                <div>
                  <h2 className="text-xl font-semibold">
                    {user.firstName} {user.lastName}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {user.emailAddresses[0]?.emailAddress}
                  </p>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {t("memberSince")}:{" "}
                    {new Date(user.createdAt!).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>{userProfile.location || t("locationNotSet")}</span>
                </div>
              </div>

              {userProfile.bio && (
                <div>
                  <h3 className="font-medium mb-2">{t("bio")}</h3>
                  <p className="text-sm text-muted-foreground">
                    {userProfile.bio}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle>{t("recentActivity")}</CardTitle>
              <CardDescription>
                {t("recentActivityDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <Package className="h-5 w-5 text-blue-500" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{t("addedPuzzle")}</p>
                    <p className="text-xs text-muted-foreground">
                      2 {t("daysAgo")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <ArrowRightLeft className="h-5 w-5 text-green-500" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{t("completedTrade")}</p>
                    <p className="text-xs text-muted-foreground">
                      1 {t("weekAgo")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <Star className="h-5 w-5 text-yellow-500" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{t("receivedReview")}</p>
                    <p className="text-xs text-muted-foreground">
                      2 {t("weeksAgo")}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Stats Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("stats")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-primary">
                  {userStats?.puzzlesOwned || 0}
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("totalPuzzles")}
                </p>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {userStats?.tradesCompleted || 0}
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("completedTrades")}
                </p>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-600">
                  {userStats?.averageRating
                    ? userStats.averageRating.toFixed(1)
                    : "0.0"}
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("averageRating")}
                </p>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {userStats?.puzzlesAvailable || 0}
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("availablePuzzles")}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("trustLevel")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center">
                <div className="text-lg font-semibold text-primary mb-2">
                  {(userStats?.tradesCompleted || 0) >= 10
                    ? "Experienced"
                    : (userStats?.tradesCompleted || 0) >= 5
                      ? "Intermediate"
                      : "Beginner"}
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(((userStats?.tradesCompleted || 0) / 10) * 100, 100)}%`,
                    }}
                  ></div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {t("trustLevelDescription")}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
