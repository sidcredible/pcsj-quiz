import Link from "next/link";
import { Muted, PageTitle } from "@/components/primitives";

export default function NotFound() {
  return (
    <div>
      <PageTitle>Not found</PageTitle>
      <p className="text-sm">
        <Muted>
          That quiz is not in the folder. It may have been renamed or replaced.
        </Muted>
      </p>
      <p className="mt-4">
        <Link href="/" className="btn">
          All quizzes
        </Link>
      </p>
    </div>
  );
}
