import Link from "next/link";
export type WorkCardData = {
  id: string;
  slug: string;
  title: string;
  artist_name: string;
  capture_year?: number;
  media_id?: string | null;
  color_mode?: string;
};
export function WorkCard({ work }: { work: WorkCardData }) {
  return (
    <Link className="work-card" href={`/works/${work.slug}`}>
      <div className="work-image">
        {work.media_id ? (
          <img
            src={`/api/media/${work.media_id}?size=small`}
            alt={`${work.artist_name} — ${work.title}`}
            loading="lazy"
          />
        ) : (
          <div className="placeholder-art">
            Изображение
            <br />
            не загружено
          </div>
        )}
      </div>
      <h3>{work.title}</h3>
      <p>{work.artist_name}</p>
      <div className="meta">
        <span>{work.capture_year ?? "Коллекционная фотография"}</span>
        <span>Подробнее ↗</span>
      </div>
    </Link>
  );
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}
export function Money({ minor }: { minor: number | string | null }) {
  return (
    <>
      {minor === null
        ? "Цена по запросу"
        : new Intl.NumberFormat("ru-RU", {
            style: "currency",
            currency: "RUB",
            maximumFractionDigits: 0,
          }).format(Number(minor) / 100)}
    </>
  );
}
export function date(value: Date | string, timezone = "Europe/Moscow") {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}
