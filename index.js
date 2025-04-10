import fetch from 'node-fetch';
import fs from 'fs/promises';
import "dotenv/config";
import chalk from 'chalk';
import ora from 'ora';
import readline from 'readline';
import cfonts from 'cfonts';
import { ethers } from 'ethers';

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) {
  throw new Error("PRIVATE_KEY tidak terdefinisi di file .env");
}
const wallet = new ethers.Wallet(PRIVATE_KEY);
const WALLET_ADDRESS = wallet.address;
const agentIdRaw = process.env.AGENT_ID;
if (!agentIdRaw) {
  throw new Error("AGENT_ID tidak terdefinisi di file .env. Pastikan Menggunakan format: AGENT_ID=73,81,101,202");
}
const agentIdArr = agentIdRaw.split(',').map(item => item.trim());

const MAX_LENGTH = 1000;
const BASE_URL = 'https://api.service.crestal.network/v1';
const PRIVY_AUTH_INIT_URL = 'https://auth.privy.io/api/v1/siwe/init';
const PRIVY_AUTH_AUTHENTICATE_URL = 'https://auth.privy.io/api/v1/siwe/authenticate';
const CRESTAL_NONCE_URL = `${BASE_URL}/nonce?user_address=`;
const CRESTAL_LOGIN_URL = `${BASE_URL}/login`;

const privyHeaders = {
  "Reqable-Id": "",
  "Host": "auth.privy.io",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (seperti Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Connection": "keep-alive",
  "Accept": "*/*",
  "Accept-Encoding": "gzip, deflate, br",
  "Content-Type": "application/json",
  "privy-app-id": "cm4v61vl108sdivml83sbeykh",
  "privy-ca-id": "c1c8a6d0-047f-4721-a138-e24279e8a0b5",
  "privy-client": "react-auth:2.4.2",
  "Origin": "https://app.crestal.network"
};

const standardHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://app.crestal.network'
};

let chatHeaders = {};

async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    console.log(chalk.redBright("❌ Gagal mengurai JSON. Respons mentah:"), text);
    throw new Error("Invalid JSON response");
  }
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

async function delayWithCountdown(ms) {
  let seconds = Math.ceil(ms / 1000);
  while (seconds > 0) {
    process.stdout.write(chalk.grey(`\rMenunggu ${seconds} Detik.... `));
    await sleep(1000);
    seconds--;
  }
  process.stdout.write('\r' + ' '.repeat(30) + '\r');
}

async function performLogin() {
  const spinner = ora(" Melakukan Proses Login...").start();
  const privyNonce = await privyInit();

  spinner.text = " Proses Autentikasi...";
  await privyAuthenticate(privyNonce);

  spinner.text = " Autentikasi Berhsasil...";
  const crestNonce = await getCrestalNonce();

  spinner.text = " Mencoba Login...";
  const { access_token, refresh_token } = await loginCrestal(crestNonce);
  updateChatHeaders(access_token);

  spinner.succeed(chalk.greenBright(" Login berhasil."));
  return { access_token, refresh_token };
}

async function privyInit() {
  const payload = { address: WALLET_ADDRESS };
  const res = await fetch(PRIVY_AUTH_INIT_URL, { method: 'POST', headers: privyHeaders, body: JSON.stringify(payload) });
  const data = await safeJson(res);
  return data.nonce;
}

async function privyAuthenticate(nonce) {
  const issuedAt = new Date().toISOString();
  const message = `app.crestal.network wants you to sign in with your Ethereum account:\n${WALLET_ADDRESS}\n\nBy signing, you are proving you own this wallet and logging in. This does not initiate a transaction atau cost any fees.\n\nURI: https://app.crestal.network\nVersion: 1\nChain ID: 8453\nNonce: ${nonce}\nIssued At: ${issuedAt}\nResources:\n- https://privy.io`;
  const signature = await wallet.signMessage(message);
  const payload = {
    chainId: "eip155:8453",
    connectorType: "injected",
    message,
    mode: "login-or-sign-up",
    signature,
    walletClientType: "metamask"
  };
  const res = await fetch(PRIVY_AUTH_AUTHENTICATE_URL, { method: 'POST', headers: privyHeaders, body: JSON.stringify(payload) });
  await safeJson(res);
  return;
}

async function getCrestalNonce() {
  const url = `${CRESTAL_NONCE_URL}${WALLET_ADDRESS}`;
  const res = await fetch(url, { method: 'GET', headers: standardHeaders });
  const data = await safeJson(res);
  return data.nonce;
}

async function loginCrestal(crestNonce) {
  const issuedAt = new Date().toISOString();
  const siweMessage = `app.crestal.network wants you to sign in with your Ethereum account:\n${WALLET_ADDRESS}\n\n\nURI: https://app.crestal.network\nVersion: 1\nChain ID: 97\nNonce: ${crestNonce}\nIssued At: ${issuedAt}`;
  const signature = await wallet.signMessage(siweMessage);
  const payload = { user_address: WALLET_ADDRESS, siwe_msg: siweMessage, signature };
  const res = await fetch(CRESTAL_LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...standardHeaders },
    body: JSON.stringify(payload)
  });
  const loginData = await safeJson(res);
  return { access_token: loginData.access_token, refresh_token: loginData.refresh_token };
}

function updateChatHeaders(token) {
  chatHeaders = {
    "accept": "application/json, text/plain, */*",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "en-US,en;q=0.9,id;q=0.8",
    "authorization": `Bearer ${token}`,
    "chain-id": "8453",
    "content-type": "application/json",
    "cookie": `session_token=${token}`,
    "origin": "https://app.crestal.network",
    "priority": "u=1, i",
    "referer": "https://app.crestal.network/",
    "sec-ch-ua": `"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"`,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": `"Windows"`,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (seperti Gecko) Chrome/134.0.0.0 Safari/537.36"
  };
}

async function reportActivity(type) {
  const url = `${BASE_URL}/report?user_address=${WALLET_ADDRESS}&type=${type}`;
  const res = await fetch(url, { method: 'POST', headers: chatHeaders });
  const data = await safeJson(res);
  console.log(chalk.cyanBright(`🎯 Reported ${type}: ${data.msg || JSON.stringify(data)}`));
}

async function getRandomMessage() {
  const fileContent = await fs.readFile('NTE-Pesan.txt', 'utf8');
  const messages = fileContent.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  if (messages.length === 0) {
    throw new Error("❌ NTE-Pesan.txt kosong atau tidak terformat dengan benar.");
  }
  return messages[Math.floor(Math.random() * messages.length)];
}

async function simulateTyping(text, delay = 1) {
  for (const char of text) {
    process.stdout.write(char);
    await sleep(delay);
  }
  process.stdout.write('\n');
}

async function sendMessage(message) {
  const trimmed = message.length > MAX_LENGTH ? message.slice(0, MAX_LENGTH) : message;
  const randomAgentId = agentIdArr[Math.floor(Math.random() * agentIdArr.length)];
  const timestamp = Math.floor(Date.now() / 1000);
  const chatId = `${WALLET_ADDRESS}-${timestamp}`;

  const payload = {
    message: trimmed,
    agent_id: parseInt(randomAgentId),
    user_address: WALLET_ADDRESS,
    chat_id: chatId
  };

  const postRes = await fetch(`${BASE_URL}/chat`, {
    method: 'POST',
    headers: chatHeaders,
    body: JSON.stringify(payload)
  });
  const postData = await safeJson(postRes);

  async function displayAgentMessage(text, agentId) {
    console.log(chalk.yellowBright(`🤖 Response Agent ${agentId}: \n`));
    await simulateTyping(chalk.magentaBright(`"${text}"`));
    console.log(chalk.blueBright("------------------------------------------------------------"));
  }

  if (Array.isArray(postData)) {
    const agentMessage = postData.find(msg => msg.author_type === 'agent');
    if (agentMessage) {
      await displayAgentMessage(agentMessage.message, agentMessage.agent_id || agentMessage.author_id);
    } else {
      console.log(chalk.red('Tidak ditemukan pesan dari agent.'));
    }
  } else if (typeof postData === 'object' && postData !== null) {
    await displayAgentMessage(postData.message, postData.agent_id || postData.author_id);
  } else {
    console.log(chalk.red('Struktur respon tidak sesuai.'));
  }
}

async function startLoop(loopCount) {
  while (true) {
    console.log(chalk.blueBright(`\nMemulai siklus dengan ${loopCount} pesan.`));
    console.log(chalk.blueBright("============================================================"));
    const { access_token } = await performLogin();
    const spinnerPesan = ora("Memuat pesan...").start();
    const fileContent = await fs.readFile('NTE-Pesan.txt', 'utf8');
    const allMessages = fileContent.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    spinnerPesan.succeed(chalk.greenBright(` Ditemukan ${allMessages.length} pesan.`));

    const activityTypes = ['interact_with_crestal_x', 'feedback', 'post_about_crestal', 'read_blog'];
    for (const type of activityTypes) {
      await reportActivity(type);
    }
    console.log(chalk.blueBright("============================================================"));

    for (let i = 1; i <= loopCount; i++) {
      const message = allMessages[Math.floor(Math.random() * allMessages.length)];
      console.log(chalk.yellowBright(`\n💬 Mengirim Pesan: "${message}" [${i}/${loopCount}]`));
      await sendMessage(message);
      if (i < loopCount) {
        const randomDelay = Math.floor(Math.random() * 10000) + 10000; 
        await delayWithCountdown(randomDelay);
      }
    }

    const userInfoRes = await fetch(`${BASE_URL}/users/${WALLET_ADDRESS}`, { method: 'GET', headers: chatHeaders });
    const userData = await safeJson(userInfoRes);
    const { rank_v1, rank, total_point, total_point_v1 } = userData;
    console.log(chalk.blueBright("============================================================="));
    console.log('👨🏻‍💼 Informasi User:');
    console.log(`➤  Rank V1        : ${rank_v1}`);
    console.log(`➤  Rank           : ${rank}`);
    console.log(`➤  Total Points   : ${total_point}`);
    console.log(`➤  Total Points V1 : ${total_point_v1}`);
    console.log(chalk.blueBright("============================================================= \n"));
    console.log(chalk.bgGreen.black(`Selesai mengirim ${loopCount} pesan. Menunggu 24 jam untuk siklus berikutnya...\n`));
    await sleep(24 * 60 * 60 * 1000);
  }
}

function askLoopCount() {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(chalk.cyan('Masukkan jumlah pesan per siklus: '), answer => {
      rl.close();
      const num = parseInt(answer);
      if (isNaN(num) || num < 1) {
        console.log(chalk.red('Nomor tidak valid. Mohon masukkan angka numerik.'));
        process.exit(1);
      }
      resolve(num);
    });
  });
}

function centerText(text, color = "cyanBright") {
  const terminalWidth = process.stdout.columns || 80;
  const padding = Math.max(0, Math.floor((terminalWidth - text.length) / 2));
  return " ".repeat(padding) + chalk[color](text);
}

(async () => {
   cfonts.say("NT Exhaust", {
          font: "block",
          align: "center",
          colors: ["cyan", "magenta"],
          background: "black",
          letterSpacing: 1,
          lineHeight: 1,
          space: true,
          maxLength: "0",
        });
        console.log(centerText("=== Telegram Channel 🚀 : NT Exhaust (@NTExhaust) ==="));
        console.log(centerText("⌞👤 Mod : @NT_Exhaust & @chelvinsanjaya⌝ \n"));
  const loopCount = await askLoopCount();
  await startLoop(loopCount);
})();
