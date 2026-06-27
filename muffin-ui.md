I want you to develop **React Native** app with **Expo** and **Expo router**. Use **Typescript**. Make sure that app supports all platforms - Web, iOS and Android.

App will be UI client for muffin-agent (langchain, langgraph agents) and should be deployed as replacement for agent-chat-ui (for now just add it as new docker to deployment and keep both UIs for now). Let's make agent-chat-ui sub-domain `muffin-chat.*` and for new app `muffin.*`. 

Branding: democratise wealth building. Everyone brings their API keys (LLM and OpenBB, re-uses agents with their API keys). Collected data and research outputs are re-used by other people, while keys stay private.

In the end I would like to have app to manage finanances:
1. One graph/agent - one page. E.g. trading decision - would eventually have custom UI page, council the same, etc.
2. For council agent in the end I want to have page where each person is presented as a separate avatar and flow of graph is visually represented on page, near each person avatar we have small pop-up demonstrating what is happening. It's just an example of how I potentially want it to look like, but we can think deeper to create catchy emotional design. Render agent graphs as conversations (especially persons council). Debates render as N people talking
3. Design has to be emotional. Main color is purple and muffin is a logo. Think on purple flat design bakery web ui cartoon. Few references: https://www.shutterstock.com/image-vector/homemade-blueberry-bakery-on-purple-260nw-2187771761.jpg , https://static.vecteezy.com/system/resources/previews/010/527/496/non_2x/blueberry-bread-on-purple-template-mockup-banner-kawaii-doodle-flat-cartoon-illustration-vector.jpg , https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSmhKWF5uGobgvTXgKfQ70H0rwQ6d3fN8QgkB8eaW3jmmRwBC_4 , https://www.vecteezy.com/vector-art/10566466-homemade-blueberry-bakery-on-purple-plaid-template-mockup-banner-kawaii-doodle-flat-cartoon-vector-illustration
4. Eventually app won't be just set of graphs to analyse individual companies, but rather whole finance management app with: options to work with different asset types. Managing wealth with different tools like SIPP, ISA, Mortgage, other, have budgeting screen demontstring all the holdings across different tools, have a goal screen: retirement, deposit for house, etc
5. I want to have a screen with Globe. On that screen use will have an option to analyse macro economy or select country or select sector or analyse sector performance. When country is selected user can analyse country performance or select individual company from this country or analyse each sector performance for this country. 
6. Another screen with Pie with high level sectors, drill down to see sub sectors.
7. For each of the ticker I want to have following properties for filtration and future analysis: sector, sub sector(s). country (developed/emerging), addressable market(s), growth/value, etc. App will work with different asset types: etf, ticker, commodities, crypto, derivatives, options, futures, qmmf, cash in different currencies , bonds, real estate, mutual funds


High-level user-flow:
* Main screen: Interactive globe/world map (maybe use SVG or some existing library) with following features:
  * click on region to open region page
  * Analyse macro economy
  * Analyse best/worst performing regions and relative/absolute changes among them (captital flow, market caps, etc across regions)
* Region page features:
  * Click on county to open country page
  * Analyse region economy
  * Analyse best/worst performing country and relative/absolute changes among them (captital flow, market caps, etc across regions)
* Country page features:
  * select sector
  * check country economy performance
  * Analyse best/worst performing sector and relative/absolute changes among them (captital flow, market caps, etc across regions)
* Sector/Sub-sectorr page features:
  * If sector - select sub-sector
  * Select stock
  * Check sector performance
  * Analyse best/worst performing stocks and relative/absolute changes among them (captital flow, market caps, etc across regions)
* Stock page:
  * Run Personas Council (custom agent UI)
  * Run Trading Decision (custom agent UI)
  * Run Stock evaluation


Few things to think upfront:
- Create new repo for it: muffin-ui.
- Right now muffin agent has a lot of configurations. I want it to be configurable per user (settings page). So everything (even API keys can be configured by user). Customisations (configured by configurable in langchain): bring own LLM provider keys, bring OpenBB provider keys, add own MCP servers to each of the agents, define tool set per agent. Create custom deepagents (define tools set, middlewares, MCP servers, skills and other things that are configurable with muffin agent builder)
- Check how langgraph api works (potentially check https://github.com/aegra/aegra) to determine how to build clients for it. Look firstly for existing and widely used solutions, try to avoid doing custom things.
- For UI components consider using `NativeWind` and optionaly `NativeWindUI` or ****React Native Reusables**. 
- For animations use **React Native Reanimated**.
- Make sure that when I create new agent - we can easily add it to the app. Consider having both: generic agent pages + custom agent pages. Also make sure that processing of api responses can be handled to well to render custom components for different model responses (e.g. custom dashboards for tool calls, separate components for indivudal sub-graphs, building hierrarchical UI of whole graph execution, custom rendering of structured outputs, Render components for tool calls, Render Intermediate messages, Render structured output as components, Render data collected as components, have subagent that dynamically builds charts, Mention which data was collected and which data collections failed, etc). We don't have to create this components now, but think upfront. You can check how https://github.com/langchain-ai/agent-chat-ui works with API.
- For authentication and database I want to migrate to Supabase. It may require updates to muffin agent itself to work with Supabase instead of plain postgresql.


Before proceeding make sure you collect all the requirements from me. Ask follow-ups and clarification questions and seek my approval on design choices you do.

Define what you deliver now and what later, we can work iteratively in milestons. Create a roadmap.md.


Another potentially useful libraries in case they are needed:
Consider `callstackincubator/react-native-bottom-tabs` for tabs.
Use `NativeWind` and optionaly `NativeWindUI` or ****React Native Reusables**. 
For animations use **React Native Reanimated**
For state managemnt `Zustand` or `legend-state`
For server state managment use **Tanstack query**
For testing you can use **Maestro** and `react-native-testing`
For monitoring use **Sentry**.
For CI/CD use **Expo EAS**
For KVP storage use **RN MMKV**
Consider using **React hook form**
For lists use **Flash list**
For displaying images consider **Expo image**
Consider `zeego` for context menus.
For manging monetization use **Revenue Cat** 
If camera is needed use **React Native vision camera**
For gestures handling use **React Native Gesture Handler**
