import { redirect } from "next/navigation";

/** /agent on its own: the agents are listed on the market. */
export default function AgentIndex() {
  redirect("/market");
}
