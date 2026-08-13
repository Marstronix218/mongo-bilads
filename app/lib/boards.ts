import billboardsData from "@/lib/billboards.json";
import type { Billboard, BillboardsFile } from "@/lib/types";

const boards = billboardsData as BillboardsFile;

export function loadBoards(): BillboardsFile {
  return boards;
}

export function getBoard(id: string): Billboard | undefined {
  return boards.find((b) => b.id === id);
}
