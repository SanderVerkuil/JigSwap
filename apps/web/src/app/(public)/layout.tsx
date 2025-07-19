import { Footer } from "@/app/_components/footer";
import { Header } from "@/app/_components/header";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="bg-background pt-[57px]">
      <Header />
      {children}
      <Footer />
    </div>
  );
}
