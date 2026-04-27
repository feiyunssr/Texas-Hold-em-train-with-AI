import { getAiCoachConfig } from "@/ai/config";
import { TrainingEntry } from "@/components/training-entry";

export default function Home() {
  const coachConfig = getAiCoachConfig();

  return (
    <main className="appShell">
      <TrainingEntry coachConfig={coachConfig} />
    </main>
  );
}
