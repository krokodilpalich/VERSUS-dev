import Link from "next/link";
export default function NotFound() {
  return (
    <div className="not-found">
      <span className="eyebrow">VERSUS / 404</span>
      <h1>Страница недоступна</h1>
      <p>Она не существует или доступна только приглашённым участникам.</p>
      <Link href="/works" className="link-arrow">
        Открыть каталог
      </Link>
    </div>
  );
}
