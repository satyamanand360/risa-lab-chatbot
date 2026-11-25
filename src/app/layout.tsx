import "./globals.css";
import Shell from "@/components/Shell";
export const metadata = { title: "Growth Center · RISA Labs Growth APM", description: "Attendee growth command center with an AI growth analyst" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><Shell>{children}</Shell></body></html>;
}
