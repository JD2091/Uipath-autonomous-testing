# UiPath Autonomous Testing

Material from the **UiPath Community Mumbai** session (10 Oct) on agentic testing with UiPath Test Cloud.

- **Presentation:** https://jd2091.github.io/Uipath-autonomous-testing
- **Solution:** `Solution/Autonomous testing system.uis` is the UiPath solution built live in the demo. The rest of this README covers it.

## What the solution does

One new record in a Data Fabric entity starts a Maestro process that turns a requirement into reviewed, executed test cases, with nobody starting it by hand.

1. **Trigger**: a Data Fabric *Record Created* event starts the process.
2. **Requirement Analyst agent**: scores the requirement 0-100 for test-readiness and explains why.
3. **Analyst approval**: a human approves or rejects in the *Requirement approval* web app.
4. **Test case creation agent**: generates test cases and steps from the approved requirement.
5. **Test Manager**: the requirement and test cases are created and published, then executed.
6. **Failure email**: an Outlook email is sent if something fails.

Projects inside the solution:

| Project | Type |
|---------|------|
| `Maestro BPMN` | Process Orchestration (the flow above) |
| `Requirement Analyst agent` | Low-code agent |
| `Test case creation agent` | Low-code agent |
| `Requirement approval` | Web app (XAML workflow action) |

## Prerequisites

- UiPath **Automation Cloud** account with **Orchestrator**, **Maestro**, **Agents**, **Data Fabric** and **Test Manager** enabled on your tenant.
- **UiPath Studio Web** (browser) or **Studio Desktop 2025.04+** with Solutions support.
- Access to **LLM Gateway** models used by the agents (`anthropic.claude-sonnet-5`, `anthropic.claude-opus-4-8`). Switch them in each agent if your tenant lacks them.
- An Outlook 365 account for the failure-email step.

## How to use the `.uis` file

1. **Get the file.** Download `Solution/Autonomous testing system.uis` as zip and extract the solution file.
   ```
   git clone <this-repo-url>
   ```
2. **Import it.**
   - *Studio Web*: Home, then **Solutions**, then **Upload** or **Import**, and pick the `.uis` file.
   - *Studio Desktop*: **File**, then **Open Solution**, and pick the `.uis` file.
3. **Rebind the connections.** The solution was exported with the author's Integration Service connections, so create your own and bind them under the solution's resources:
   - `UiPath Data Fabric` (*uipath-uipath-dataservice*): trigger source
   - `UiPath Test Manager` (*uipath-uipath-testmanager*): requirements and test cases
   - `Microsoft Outlook 365` (*uipath-microsoft-outlook365*): failure email
4. **Create the Data Fabric entity** that the *Record Created* trigger watches. It needs a requirement text field, plus the requester email if the process emails them. Check the entity name and fields in the trigger node of `Maestro BPMN` and match them.
5. **Check the Test Manager project.** Select a Test Manager project in the *Create Requirement* and test-case nodes. It must exist in your tenant.
6. **Validate and debug.** Open `Maestro BPMN` and run **Debug**. Fix any binding or folder warnings.
7. **Publish and deploy.** Publish the solution and deploy it to an Orchestrator folder (**Publish**, then **Deploy**). Packages, agents, the web app and the process are deployed together.
8. **Run it.** Add a record to the Data Fabric entity. The process starts, and the analyst approval task appears in **Action Center** or the web app.

## Troubleshooting

- **Trigger never fires**: check that the Data Fabric connection is bound and the process is deployed and active in the folder.
- **Agent fails on the model**: pick a model that is available on your tenant in the agent's settings.
- **Test Manager errors**: confirm the connection user has rights on the target Test Manager project.

## Notes

- The `.uis` is a zip archive (`unzip -l` lists its contents), useful for reviewing the agent prompts and BPMN without importing.
- Do not commit tenant secrets or personal connection details to this repo.
