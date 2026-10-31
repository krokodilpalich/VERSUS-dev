import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { getActor, isStaff } from "@/modules/auth/policy";
import { SignOut } from "@/components/forms";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "VERSUS — коллекционная фотография",
    template: "%s · VERSUS",
  },
  description:
    "Единая точка входа в мир коллекционной фотографии. Discover / Connect / Collect.",
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await getActor(await headers());
  return (
    <html lang="ru">
      <body>
        <a className="skip" href="#main">
          К содержимому
        </a>
        {process.env.DEMO_MODE === "true" && (
          <div className="demo-banner">
            ДЕМОНСТРАЦИОННАЯ СРЕДА · Вымышленные авторы и работы · Платежи и
            ставки отключены
          </div>
        )}
        <header>
          <Link className="brand" href="/" aria-label="VERSUS — главная">
            VERSUS
          </Link>
          <nav aria-label="Основная навигация">
            <Link href="/works">Произведения</Link>
            <Link href="/artists">Авторы</Link>
            <Link href="/galleries">Галереи</Link>
            <Link href="/open-calls">Open calls</Link>
            <Link href="/journal">Журнал</Link>
          </nav>
          <div className="account">
            {actor ? (
              <>
                <Link href="/dashboard">Кабинет</Link>
                {isStaff(actor) && <Link href="/admin">Управление</Link>}
                <SignOut />
              </>
            ) : (
              <Link href="/sign-in">Войти ↗</Link>
            )}
          </div>
        </header>
        <main id="main">{children}</main>
        <footer>
          <div>
            <Link className="brand" href="/">
              VERSUS
            </Link>
            <p>
              Discover / Connect / Collect
              <br />
              Независимая среда коллекционной фотографии.
            </p>
            <small>© {new Date().getFullYear()} VERSUS</small>
          </div>
          <div className="footer-links">
            <Link href="/about">О платформе</Link>
            <Link href="/how-it-works">Как это работает</Link>
            <Link href="/trust">Доверие и права</Link>
            <Link href="/contact">Контакты</Link>
            <Link href="/events">События</Link>
            <Link href="/auctions">Аукционы</Link>
            <Link href="/private">Private Circle</Link>
            <Link href="/legal/privacy">Конфиденциальность</Link>
            <Link href="/legal/terms">Условия</Link>
            <Link href="/legal/sales">Условия продажи</Link>
            <Link href="/legal/cookies">Cookies</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
