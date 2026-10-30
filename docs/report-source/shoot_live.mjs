// Screenshots the deployed frontend (Vercel) for the deployment chapter.
import { launch, ensureDir } from "./cdp.mjs";
const here = (p) => new URL(p, import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
ensureDir(here("./img/"));

const b = await launch({ port: 9341, profile: here("./edge-cdp-live/"), width: 1280, height: 800, scale: 1.5 });
try {
  await b.goto("https://elixor-dun.vercel.app", 6000);
  await b.waitFor(`document.querySelector('input[type=email], input[type=password]')`, 30000);
  await b.shot(here("./img/live_01_landing.jpg"));
  await b.goto("https://elixor-dun.vercel.app/patient", 6000);
  await b.shot(here("./img/live_02_patient_redirect.jpg"));
  console.log("url after /patient:", await b.eval("location.href"));
} finally {
  await b.close();
}
