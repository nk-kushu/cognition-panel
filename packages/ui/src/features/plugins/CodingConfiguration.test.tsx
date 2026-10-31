import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { useState } from "react";
import { ConfigProvider } from "antd";
import type { AgentConfiguration } from "@kushex/contracts";
import { CodingConfiguration } from "../../../../../plugins/coding/ui";

function Editor() {
  const [value, setValue] = useState<AgentConfiguration>({});
  return (
    <ConfigProvider>
      <CodingConfiguration
        value={value}
        onChange={setValue}
        disabled={false}
        agentName="coding"
        projectId="project-one"
      />
      <output aria-label="Saved configuration">{JSON.stringify(value)}</output>
    </ConfigProvider>
  );
}
it("edits skill and guard settings independently and restores catalog defaults", async () => {
  const user = userEvent.setup();
  render(<Editor />);
  expect(screen.getByRole("tab", { name: "Skills (5)" })).toBeInTheDocument();
  await user.click(screen.getByText("Code readability"));
  await user.click(screen.getByLabelText("Code readability skill selection"));
  await user.click(await screen.findByTitle("Required"));
  expect(screen.getByLabelText("Saved configuration")).toHaveTextContent('"skillMode":"required"');
  await user.click(screen.getByRole("tab", { name: "Guards (12)" }));
  await user.click(screen.getByText("Input validation"));
  const instructions = screen.getByLabelText("Input validation reviewer instructions");
  await user.clear(instructions);
  await user.type(instructions, "Check API boundaries.");
  expect(screen.getByLabelText("Saved configuration")).toHaveTextContent(
    '"reviewInstructions":"Check API boundaries."',
  );
  await user.click(screen.getByRole("button", { name: "Reset Input validation defaults" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Saved configuration")).not.toHaveTextContent(
      '"input-validation-guard"',
    ),
  );
  expect(screen.getByLabelText("Saved configuration")).toHaveTextContent('"skillMode":"required"');
});
