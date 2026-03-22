import { useState, useEffect, useRef } from 'react';

// ══ PALETTE ══════════════════════════════════════════════════════════════════
const C={
  bg:"#fdf6e9",card:"#fff",gold:"#c8860a",goldL:"#e8a820",
  text:"#2c1a06",muted:"#a07840",border:"rgba(160,120,64,.28)",
  teal:"#0e6674",green:"#1e6b3c",red:"#b03020",purple:"#7c3aed"
};
const LEVEL_META={
  basic:{label:"Basic",color:"#1e6b3c",light:"#4ade80",bg:"rgba(30,107,60,.12)",icon:"🌱",desc:"Script, vowels, consonants, basic vocabulary"},
  intermediate:{label:"Intermediate",color:"#0e6674",light:"#22d3ee",bg:"rgba(14,102,116,.12)",icon:"📚",desc:"Words, phrases, grammar, conversations"},
  advanced:{label:"Advanced",color:"#7c3aed",light:"#a78bfa",bg:"rgba(124,58,237,.12)",icon:"🏆",desc:"Literature, complex grammar, formal writing, fluency"}
};

// ══ PERSISTENT LOCAL STORAGE (localStorage — browser-based) ══════════════════
// Data persists across sessions in the same browser on the same device.

const EMPTY_PROGRESS={xp:0,words:0,sessions:0,streak:1,testScores:[],
  daysCompleted:{basic:0,intermediate:0,advanced:0},minutesSpent:0};

// ── storage helpers ───────────────────────────────────────────────────────────
async function stGet(key){
  try{const r=localStorage.getItem(key);return r?JSON.parse(r):null;}
  catch(e){return null;}
}
async function stSet(key,val){
  try{localStorage.setItem(key,JSON.stringify(val));return true;}
  catch(e){return false;}
}
async function stDel(key){
  try{localStorage.removeItem(key);}catch(e){}
}
async function stList(prefix){
  try{
    const keys=[];
    for(let i=0;i<localStorage.length;i++){
      const k=localStorage.key(i);
      if(k&&k.startsWith(prefix))keys.push(k);
    }
    return keys;
  }catch(e){return[];}
}

// ── Simple password hash (SHA-256 via SubtleCrypto) ───────────────────────────
async function hashPw(pw){
  const buf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

// ── DB API ────────────────────────────────────────────────────────────────────
async function dbRegister(email,name,username,password){
  const e=email.toLowerCase().trim();
  // Check duplicate email
  const existing=await stGet(`user:email:${e}`);
  if(existing)return{error:"Email already registered."};
  // Check duplicate username
  const unCheck=await stGet(`user:username:${username}`);
  if(unCheck)return{error:"Username already taken."};
  const id="u_"+Date.now()+"_"+Math.random().toString(36).slice(2,8);
  const pwHash=await hashPw(password);
  const joined=new Date().toLocaleDateString("en-US",{month:"short",year:"numeric"});
  const profile={id,email:e,username,name,avatar:"🧑",joined,
    nativeLang:"Hindi",location:"—",currentLevel:"basic"};
  // Store user record
  await stSet(`user:id:${id}`,{...profile,pwHash});
  await stSet(`user:email:${e}`,id);         // email → id index
  await stSet(`user:username:${username}`,id); // username → id index
  // Store blank progress
  await stSet(`progress:${id}`,{...EMPTY_PROGRESS});
  return{user:profile};
}

async function dbLogin(emailOrUser,password){
  const input=emailOrUser.toLowerCase().trim();
  // Resolve to user ID
  let uid=await stGet(`user:email:${input}`);
  if(!uid)uid=await stGet(`user:username:${input}`);
  if(!uid)return{error:"No account found with that email or username."};
  const record=await stGet(`user:id:${uid}`);
  if(!record)return{error:"Account data missing. Please re-register."};
  const pwHash=await hashPw(password);
  if(record.pwHash!==pwHash)return{error:"Incorrect password."};
  const{pwHash:_,...profile}=record;
  const progress=await stGet(`progress:${uid}`)||{...EMPTY_PROGRESS};
  // Save active session token
  const token="sess_"+Date.now()+"_"+Math.random().toString(36).slice(2,10);
  await stSet(`session:${uid}`,{token,at:Date.now()});
  // Also save to localStorage so same-browser auto-login works
  try{localStorage.setItem("ak_session",JSON.stringify({uid,token}));}catch(e){}
  return{user:profile,progress};
}

async function dbRestoreSession(){
  try{
    const raw=localStorage.getItem("ak_session");
    if(!raw)return null;
    const{uid,token}=JSON.parse(raw);
    const sess=await stGet(`session:${uid}`);
    if(!sess||sess.token!==token)return null;
    // Session valid — refresh timestamp
    await stSet(`session:${uid}`,{token,at:Date.now()});
    const record=await stGet(`user:id:${uid}`);
    if(!record)return null;
    const{pwHash:_,...profile}=record;
    const progress=await stGet(`progress:${uid}`)||{...EMPTY_PROGRESS};
    return{user:profile,progress};
  }catch(e){return null;}
}

async function dbSaveProgress(userId,patch){
  const current=await stGet(`progress:${userId}`)||{};
  await stSet(`progress:${userId}`,{...current,...patch});
}

async function dbLogout(userId){
  if(userId)await stDel(`session:${userId}`);
  try{localStorage.removeItem("ak_session");}catch(e){}
}

async function dbSendPasswordReset(email){
  // We generate a reset token stored in localStorage and shown on screen for the user to copy
  const e=email.toLowerCase().trim();
  const uid=await stGet(`user:email:${e}`);
  if(!uid)return{error:"No account found with that email."};
  const code=String(Math.floor(100000+Math.random()*900000));
  await stSet(`reset:${e}`,{code,expiry:Date.now()+600000});
  return{ok:true,code}; // We show the code on-screen since no real email server
}

async function dbResetPassword(email,code,newPassword){
  const e=email.toLowerCase().trim();
  const rec=await stGet(`reset:${e}`);
  if(!rec)return{error:"No reset request found. Please start again."};
  if(Date.now()>rec.expiry)return{error:"Code expired. Please request a new one."};
  if(rec.code!==code)return{error:"Incorrect code."};
  const uid=await stGet(`user:email:${e}`);
  if(!uid)return{error:"Account not found."};
  const record=await stGet(`user:id:${uid}`);
  if(!record)return{error:"Account data missing."};
  const pwHash=await hashPw(newPassword);
  await stSet(`user:id:${uid}`,{...record,pwHash});
  await stDel(`reset:${e}`);
  return{ok:true};
}

const DEMO_USER={
  id:"demo_user",email:"demo@aksharadhara.in",username:"demo_student",
  name:"Demo Student",avatar:"🎓",joined:"Jan 2024",
  nativeLang:"Hindi",location:"Kerala",isDemo:true
};
const DEMO_PROGRESS={
  xp:1250,words:340,sessions:18,streak:7,
  testScores:[85,90,78,92],minutesSpent:210,
  daysCompleted:{basic:30,intermediate:30,advanced:30}
};

const genUN=n=>n.toLowerCase().replace(/\s+/g,"_").replace(/[^a-z0-9_]/g,"")+"_"+Math.floor(100+Math.random()*900);

// ══ 3-LEVEL CURRICULUM ═══════════════════════════════════════════════════════
const CURRICULUM={
  basic:[
    // Week 1 — Script Foundations
    {d:1,t:"Malayalam Vowels (Swarams)",topic:"vowels",week:1,s:"active"},
    {d:2,t:"Consonants: Ka to Na (ക-ന)",topic:"consonants_1",week:1,s:"locked"},
    {d:3,t:"Consonants: Pa to La (പ-ല)",topic:"consonants_2",week:1,s:"locked"},
    {d:4,t:"Consonants: Va to Ha (വ-ഹ)",topic:"consonants_3",week:1,s:"locked"},
    {d:5,t:"Vowel Signs (Matras/Chihnam)",topic:"matras",week:1,s:"locked"},
    {d:6,t:"Week 1 Test — Script",topic:"test",week:1,s:"locked",tst:true},
    // Week 2 — Numbers & Basic Vocab
    {d:7,t:"Numbers 1–10 (Onnu to Pathu)",topic:"numbers_1",week:2,s:"locked"},
    {d:8,t:"Numbers 11–100",topic:"numbers_2",week:2,s:"locked"},
    {d:9,t:"Colours (Niraṅṅaḷ)",topic:"colors",week:2,s:"locked"},
    {d:10,t:"Body Parts (Shareerabhaagam)",topic:"body",week:2,s:"locked"},
    {d:11,t:"Animals & Nature (Mrigam)",topic:"animals",week:2,s:"locked"},
    {d:12,t:"Week 2 Test — Numbers & Vocab",topic:"test",week:2,s:"locked",tst:true},
    // Week 3 — Daily Life
    {d:13,t:"Greetings & Introductions",topic:"greetings",week:3,s:"locked"},
    {d:14,t:"Family Members (Kudumbam)",topic:"family",week:3,s:"locked"},
    {d:15,t:"Food & Drinks (Saappaadu)",topic:"food",week:3,s:"locked"},
    {d:16,t:"Days of the Week",topic:"days",week:3,s:"locked"},
    {d:17,t:"Months & Seasons",topic:"months",week:3,s:"locked"},
    {d:18,t:"Week 3 Test — Daily Life",topic:"test",week:3,s:"locked",tst:true},
    // Week 4 — Simple Sentences
    {d:19,t:"Simple Sentences: 'I am…'",topic:"sentences_1",week:4,s:"locked"},
    {d:20,t:"Simple Questions: 'What is…?'",topic:"questions_1",week:4,s:"locked"},
    {d:21,t:"Directions & Places",topic:"directions",week:4,s:"locked"},
    {d:22,t:"Time & Clock",topic:"time",week:4,s:"locked"},
    {d:23,t:"Shopping Vocabulary",topic:"shopping",week:4,s:"locked"},
    {d:24,t:"Week 4 Test — Sentences",topic:"test",week:4,s:"locked",tst:true},
    // Week 5 — Review & Assessment
    {d:25,t:"Pronouns (Naamavisheshanam)",topic:"pronouns",week:5,s:"locked"},
    {d:26,t:"Common Verbs (Kriyas)",topic:"verbs_basic",week:5,s:"locked"},
    {d:27,t:"Adjectives (Visheshan)",topic:"adjectives",week:5,s:"locked"},
    {d:28,t:"Putting It Together — Review",topic:"review_basic",week:5,s:"locked"},
    {d:29,t:"Conversation Practice 1",topic:"conversation_1",week:5,s:"locked"},
    {d:30,t:"Final Basic Test",topic:"test_final",week:5,s:"locked",tst:true},
  ],
  intermediate:[
    // Week 1 — Grammar Foundations
    {d:1,t:"Present Tense (Varthamaana Kaalam)",topic:"present_tense",week:1,s:"locked"},
    {d:2,t:"Past Tense (Bhootha Kaalam)",topic:"past_tense",week:1,s:"locked"},
    {d:3,t:"Future Tense (Bhaavi Kaalam)",topic:"future_tense",week:1,s:"locked"},
    {d:4,t:"Negation & Questions",topic:"negation",week:1,s:"locked"},
    {d:5,t:"Postpositions (Sambandham)",topic:"postpositions",week:1,s:"locked"},
    {d:6,t:"Week 1 Test — Tenses",topic:"test",week:1,s:"locked",tst:true},
    // Week 2 — Expanded Vocabulary
    {d:7,t:"At the Market (Chanta)",topic:"market",week:2,s:"locked"},
    {d:8,t:"Travel & Transport",topic:"travel",week:2,s:"locked"},
    {d:9,t:"Health & Body (Aarogyam)",topic:"health",week:2,s:"locked"},
    {d:10,t:"Weather & Seasons",topic:"weather",week:2,s:"locked"},
    {d:11,t:"Occupations & Work",topic:"work",week:2,s:"locked"},
    {d:12,t:"Week 2 Test — Vocabulary",topic:"test",week:2,s:"locked",tst:true},
    // Week 3 — Conversational Malayalam
    {d:13,t:"Making Requests Politely",topic:"requests",week:3,s:"locked"},
    {d:14,t:"Expressing Opinions",topic:"opinions",week:3,s:"locked"},
    {d:15,t:"Phone & Email Conversations",topic:"phone",week:3,s:"locked"},
    {d:16,t:"Telling Stories (Kathakal)",topic:"stories",week:3,s:"locked"},
    {d:17,t:"Formal vs. Informal Speech",topic:"formal_informal",week:3,s:"locked"},
    {d:18,t:"Week 3 Test — Conversation",topic:"test",week:3,s:"locked",tst:true},
    // Week 4 — Reading & Writing
    {d:19,t:"Reading Simple Passages",topic:"reading_1",week:4,s:"locked"},
    {d:20,t:"Writing Short Paragraphs",topic:"writing_1",week:4,s:"locked"},
    {d:21,t:"Compound Words (Samasam)",topic:"compound",week:4,s:"locked"},
    {d:22,t:"Common Idioms & Phrases",topic:"idioms",week:4,s:"locked"},
    {d:23,t:"Proverbs (Pazhamozhi)",topic:"proverbs_intro",week:4,s:"locked"},
    {d:24,t:"Week 4 Test — Reading/Writing",topic:"test",week:4,s:"locked",tst:true},
    // Week 5 — Intermediate Mastery
    {d:25,t:"Kerala Culture & Festivals",topic:"culture",week:5,s:"locked"},
    {d:26,t:"Describing Places & Journeys",topic:"places",week:5,s:"locked"},
    {d:27,t:"Expressing Feelings",topic:"feelings",week:5,s:"locked"},
    {d:28,t:"News & Media Vocabulary",topic:"media",week:5,s:"locked"},
    {d:29,t:"Conversation Practice 2",topic:"conversation_2",week:5,s:"locked"},
    {d:30,t:"Final Intermediate Test",topic:"test_final",week:5,s:"locked",tst:true},
  ],
  advanced:[
    // Week 1 — Complex Grammar
    {d:1,t:"Complex Sentence Structures",topic:"complex_sentences",week:1,s:"locked"},
    {d:2,t:"Conditional Clauses (Samaasam)",topic:"conditionals",week:1,s:"locked"},
    {d:3,t:"Passive Voice (Karma Vaachyam)",topic:"passive",week:1,s:"locked"},
    {d:4,t:"Relative Clauses",topic:"relative",week:1,s:"locked"},
    {d:5,t:"Reported Speech",topic:"reported",week:1,s:"locked"},
    {d:6,t:"Week 1 Test — Grammar",topic:"test",week:1,s:"locked",tst:true},
    // Week 2 — Literature & Poetry
    {d:7,t:"Classical Malayalam Poetry",topic:"poetry",week:2,s:"locked"},
    {d:8,t:"Ramayana in Malayalam",topic:"ramayana",week:2,s:"locked"},
    {d:9,t:"Modern Malayalam Literature",topic:"literature",week:2,s:"locked"},
    {d:10,t:"Literary Devices & Rhetoric",topic:"rhetoric",week:2,s:"locked"},
    {d:11,t:"Famous Kerala Proverbs",topic:"proverbs_adv",week:2,s:"locked"},
    {d:12,t:"Week 2 Test — Literature",topic:"test",week:2,s:"locked",tst:true},
    // Week 3 — Formal & Professional
    {d:13,t:"Formal Letter Writing",topic:"letters",week:3,s:"locked"},
    {d:14,t:"Business Malayalam",topic:"business",week:3,s:"locked"},
    {d:15,t:"Academic Writing",topic:"academic",week:3,s:"locked"},
    {d:16,t:"Legal & Official Language",topic:"legal",week:3,s:"locked"},
    {d:17,t:"News & Journalism Style",topic:"journalism",week:3,s:"locked"},
    {d:18,t:"Week 3 Test — Formal Language",topic:"test",week:3,s:"locked",tst:true},
    // Week 4 — Deep Fluency
    {d:19,t:"Dialectal Variations in Kerala",topic:"dialects",week:4,s:"locked"},
    {d:20,t:"Sanskrit Loanwords in Malayalam",topic:"sanskrit",week:4,s:"locked"},
    {d:21,t:"Debates & Argumentation",topic:"debate",week:4,s:"locked"},
    {d:22,t:"Humour & Wordplay (Tharavam)",topic:"humour",week:4,s:"locked"},
    {d:23,t:"Film & Music Malayalam",topic:"films",week:4,s:"locked"},
    {d:24,t:"Week 4 Test — Deep Fluency",topic:"test",week:4,s:"locked",tst:true},
    // Week 5 — Mastery
    {d:25,t:"Translation Techniques",topic:"translation",week:5,s:"locked"},
    {d:26,t:"Interpretation & Nuance",topic:"nuance",week:5,s:"locked"},
    {d:27,t:"Story Writing in Malayalam",topic:"story_writing",week:5,s:"locked"},
    {d:28,t:"Public Speaking (Prabhashanam)",topic:"speaking",week:5,s:"locked"},
    {d:29,t:"Full Conversation: Real-World",topic:"realworld",week:5,s:"locked"},
    {d:30,t:"Final Advanced Test — Mastery",topic:"test_final",week:5,s:"locked",tst:true},
  ]
};

// ══ FLASHCARDS PER LEVEL ═════════════════════════════════════════════════════
const FLASHCARDS={
  basic:[
    {id:1,vowel:"അ",front:"Which letter is this?\n അ",back:"'അ' — sounds like 'a' in cup\nHindi: अ | Example: അമ്മ (mother)",q:"What sound does 'അ' make?",opts:["aa like father","a like cup","i like bit","u like put"],ans:1},
    {id:2,vowel:"ആ",front:"Which letter is this?\n ആ",back:"'ആ' — long 'aa' sound\nHindi: आ | Example: ആന (elephant)",q:"'ആ' is which Hindi vowel?",opts:["अ","आ","इ","ई"],ans:1},
    {id:3,vowel:"ഇ",front:"This letter means 'leaf' starts with...",back:"ഇല (ila) = leaf\n'ഇ' like 'i' in bit | Hindi: इ",q:"'ഇ' sounds like…",opts:["ee in see","i in bit","a in father","u in put"],ans:1},
    {id:4,vowel:"ഈ",front:"Long 'ii' sound — which letter?",back:"'ഈ' is the long form of ഇ\nLike 'ee' in see | Example: ഈച്ച (fly)",q:"ഇ vs ഈ — which is longer?",opts:["ഇ (short)","ഈ (long)","Same","Neither"],ans:1},
    {id:5,vowel:"ക",front:"What is this consonant?\n ക",back:"'ക' = 'ka' sound\nLike 'k' in kite\nExample: കണ്ണ് (eye)",q:"'ക' sounds like…",opts:["ga in gate","ka in kite","cha in chat","ta in tap"],ans:1},
    {id:6,vowel:"മ",front:"'മ' is which consonant?",back:"'മ' = 'ma' sound\nLike 'm' in mother\nExample: മരം (tree)",q:"'മ' transliterates as…",opts:["na","ba","ma","la"],ans:2},
    {id:7,vowel:"ഒന്ന്",front:"What number is ഒന്ന്?",back:"ഒന്ന് = One (1)\nPronounced: 'onnu'\nUsed in counting",q:"ഒന്ന് means…",opts:["Two","Three","One","Four"],ans:2},
    {id:8,vowel:"നാല്",front:"നാല് = ?",back:"നാല് = Four (4)\nPronounced: 'naal'\nRemember: n-aa-l",q:"നാല് means…",opts:["Three","Four","Five","Six"],ans:1},
    {id:9,vowel:"ചുവപ്പ്",front:"ചുവപ്പ് is what colour?",back:"ചുവപ്പ് = Red\nPronounced: 'chuvappu'\nLike the colour of a rose",q:"ചുവപ്പ് means…",opts:["Blue","Green","Yellow","Red"],ans:3},
    {id:10,vowel:"നന്ദി",front:"നന്ദി is a greeting.\nWhat does it mean?",back:"നന്ദി = Thank you\nPronounced: 'nandi'\nUsed in polite conversation",q:"നന്ദി means…",opts:["Hello","Goodbye","Thank you","Sorry"],ans:2},
    {id:11,vowel:"അമ്മ",front:"അമ്മ = ?",back:"അമ്മ = Mother\nPronounced: 'amma'\nOne of the first words in Malayalam",q:"അമ്മ means…",opts:["Father","Mother","Sister","Brother"],ans:1},
    {id:12,vowel:"ഭക്ഷണം",front:"ഭക്ഷണം relates to…",back:"ഭക്ഷണം = Food\nPronounced: 'bhakshanam'\nUsed when talking about eating",q:"ഭക്ഷണം means…",opts:["Water","Food","House","Road"],ans:1},
  ],
  intermediate:[
    {id:1,vowel:"പോകുന്നു",front:"'പോകുന്നു' — what tense?",back:"പോകുന്നു = 'going' (present)\nRoot: പോക (to go)\nUsed for ongoing actions",q:"'പോകുന്നു' is in which tense?",opts:["Past","Present","Future","Conditional"],ans:1},
    {id:2,vowel:"പോയി",front:"'പോയി' — what tense?",back:"പോയി = 'went' (past)\nRoot: പോക (to go)\nSimple past action",q:"'പോയി' is in which tense?",opts:["Present","Future","Past","Imperative"],ans:2},
    {id:3,vowel:"പോകും",front:"'പോകും' — what tense?",back:"പോകും = 'will go' (future)\nRoot: പോക (to go)\nExpresses future intention",q:"'പോകും' is in which tense?",opts:["Past","Present","Future","Perfect"],ans:2},
    {id:4,vowel:"ചന്ത",front:"ചന്ത = ?",back:"ചന്ത = Market/Bazaar\nPronounced: 'chantha'\nWhere you buy vegetables & goods",q:"ചന്ത means…",opts:["Temple","Market","School","Hospital"],ans:1},
    {id:5,vowel:"ആശുപത്രി",front:"ആശുപത്രി = ?",back:"ആശുപത്രി = Hospital\nPronounced: 'aashupathri'\nWhere doctors treat patients",q:"ആശുപത്രി means…",opts:["School","Police station","Hospital","Temple"],ans:2},
    {id:6,vowel:"ദയവായി",front:"ദയവായി = ?",back:"ദയവായി = Please\nPronounced: 'dayavayi'\nUsed to make polite requests",q:"ദയവായി means…",opts:["Thank you","Sorry","Please","Excuse me"],ans:2},
    {id:7,vowel:"വേദന",front:"വേദന = ?",back:"വേദന = Pain/Ache\nPronounced: 'vedana'\nUsed when describing discomfort",q:"വേദന means…",opts:["Joy","Pain","Hunger","Thirst"],ans:1},
    {id:8,vowel:"മഴ",front:"മഴ = ?",back:"മഴ = Rain\nPronounced: 'mazha'\nKerala gets heavy monsoon rain!",q:"മഴ means…",opts:["Sun","Wind","Rain","Cloud"],ans:2},
    {id:9,vowel:"സമ്മതം",front:"'സമ്മതം' means agreement.\nHow do you say 'I agree'?",back:"ഞാൻ സമ്മതിക്കുന്നു\n= I agree\nFormal expression of consent",q:"സമ്മതം relates to…",opts:["Disagreement","Agreement","Question","Request"],ans:1},
    {id:10,vowel:"പഴമൊഴി",front:"പഴമൊഴി = ?",back:"പഴമൊഴി = Proverb\nPronounced: 'pazhamozhi'\nAncient wisdom in short sayings",q:"പഴമൊഴി means…",opts:["Story","Song","Proverb","Poem"],ans:2},
    {id:11,vowel:"ഉത്സവം",front:"ഉത്സവം = ?",back:"ഉത്സവം = Festival\nPronounced: 'utsavam'\nOnam & Vishu are Kerala festivals",q:"ഉത്സവം means…",opts:["Work","Festival","School","Temple"],ans:1},
    {id:12,vowel:"വഴി",front:"വഴി = ?",back:"വഴി = Road / Way\nPronounced: 'vazhi'\nUsed for directions & paths",q:"വഴി means…",opts:["River","Road","Mountain","Sea"],ans:1},
  ],
  advanced:[
    {id:1,vowel:"ഉണ്ടായിരുന്നു",front:"'ഉണ്ടായിരുന്നു' is which form?",back:"ഉണ്ടായിരുന്നു = 'was there / existed'\nPast habitual/continuous form\nUsed for past states",q:"ഉണ്ടായിരുന്നു expresses…",opts:["Future possibility","Past existence","Present action","Condition"],ans:1},
    {id:2,vowel:"ആകുമായിരുന്നു",front:"Conditional past — identify it",back:"ആകുമായിരുന്നു = 'would have been'\nCounterfactual conditional\nExpresses unrealised past",q:"This is a…",opts:["Simple past","Future tense","Conditional past","Imperative"],ans:2},
    {id:3,vowel:"കർമ്മവാചകം",front:"കർമ്മവാചകം = ?",back:"കർമ്മവാചകം = Passive voice\nWhen subject receives the action\nEx: The letter was written",q:"കർമ്മവാചകം means…",opts:["Active voice","Passive voice","Question form","Negative form"],ans:1},
    {id:4,vowel:"ആശ്ലേഷം",front:"Literary term: ആശ്ലേഷം",back:"ആശ്ലേഷം = Embrace / Alliteration\nUsed in classical Malayalam poetry\nA key poetic device",q:"ആശ്ലേഷം is a…",opts:["Grammar rule","Poetic device","Verb form","Noun type"],ans:1},
    {id:5,vowel:"ഉദ്ദേശ്യം",front:"ഉദ്ദേശ്യം = ?",back:"ഉദ്ദേശ്യം = Purpose / Intention\nPronounced: 'uddesyam'\nUsed in formal & academic writing",q:"ഉദ്ദേശ്യം means…",opts:["Result","Method","Purpose","Question"],ans:2},
    {id:6,vowel:"സന്ദർഭം",front:"സന്ദർഭം = ?",back:"സന്ദർഭം = Context / Occasion\nPronounced: 'sandarbham'\nCritical for understanding nuance",q:"സന്ദർഭം means…",opts:["Sentence","Context","Grammar","Paragraph"],ans:1},
    {id:7,vowel:"ഭാഷ",front:"ഭാഷ = ?",back:"ഭാഷ = Language\nPronounced: 'bhaasha'\nMalayalam is one of India's classical languages",q:"ഭാഷ means…",opts:["Culture","Language","Writing","Literature"],ans:1},
    {id:8,vowel:"പ്രബന്ധം",front:"പ്രബന്ധം = ?",back:"പ്രബന്ധം = Essay / Dissertation\nPronounced: 'prabandham'\nFormal academic writing",q:"പ്രബന്ധം means…",opts:["Story","Poem","Essay","Letter"],ans:2},
    {id:9,vowel:"തർക്കം",front:"തർക്കം = ?",back:"തർക്കം = Debate / Argument\nPronounced: 'tharkam'\nUsed in academic & formal debates",q:"തർക്കം means…",opts:["Agreement","Discussion","Debate","Silence"],ans:2},
    {id:10,vowel:"ദ്വന്ദ്വം",front:"ദ്വന്ദ്വം in grammar = ?",back:"ദ്വന്ദ്വം = Compound / Dual\nSanskrit-origin grammatical term\nUsed in advanced compound words",q:"ദ്വന്ദ്വം refers to…",opts:["Single words","Compound/Dual forms","Verbs","Prepositions"],ans:1},
    {id:11,vowel:"വ്യാകരണം",front:"വ്യാകരണം = ?",back:"വ്യാകരണം = Grammar\nPronounced: 'vyaakaranam'\nThe rules of the Malayalam language",q:"വ്യാകരണം means…",opts:["Dictionary","Literature","Grammar","Script"],ans:2},
    {id:12,vowel:"കിളിപ്പാട്ട്",front:"കിളിപ്പാട്ട് is a form of…",back:"കിളിപ്പാട്ട് = Classical poetic form\nBird-song style of narration\nUsed in Adhyatma Ramayanam",q:"കിളിപ്പാട്ട് is…",opts:["A dance form","A classical poetic form","A type of food","A festival"],ans:1},
  ]
};

// ══ TOPIC → FLASHCARD MAPPING (only show relevant cards per lesson) ══════════
// Each topic maps to an array of flashcard IDs from FLASHCARDS[level]
const TOPIC_CARDS={
  basic:{
    vowels:        [1,2,3,4],          // vowel letters
    consonants_1:  [5,6],              // ka, ma consonants
    consonants_2:  [5,6],
    consonants_3:  [5,6],
    matras:        [1,2,3,4],
    numbers_1:     [7,8],              // numbers
    numbers_2:     [7,8],
    colors:        [9],                // colours
    body:          [10,11],            // basic vocab
    animals:       [10,11],
    greetings:     [10],               // nandi = thank you
    family:        [11],               // amma = mother
    food:          [12],               // bhakshanam = food
    days:          [7,8],
    months:        [7,8],
    sentences_1:   [10,11,12],
    questions_1:   [10,11,12],
    directions:    [10,11],
    time:          [7,8,10],
    shopping:      [9,12],
    pronouns:      [1,2,3,4,5,6],
    verbs_basic:   [5,6,10,11],
    adjectives:    [9,10,11],
    review_basic:  [1,2,3,4,5,6,7,8,9,10,11,12],  // all for review
    conversation_1:[10,11,12,7,9],
    test_final:    [1,2,3,4,5,6,7,8,9,10,11,12],
    test:          [1,2,3,4,5,6,7,8,9,10,11,12],
  },
  intermediate:{
    present_tense: [1],
    past_tense:    [2],
    future_tense:  [3],
    negation:      [1,2,3],
    postpositions: [1,2,3],
    market:        [4],                // chantha = market
    travel:        [8,12],             // mazha, vazhi
    health:        [5,7],              // hospital, pain
    weather:       [8],                // mazha = rain
    work:          [5,4],
    requests:      [6],                // dayavayi = please
    opinions:      [9],                // sammtham = agreement
    phone:         [6,9],
    stories:       [9,10],             // proverb context
    formal_informal:[6,9],
    reading_1:     [4,5,6,7,8,9,10,11,12],
    writing_1:     [4,5,6,7,8,9],
    compound:      [10,11],
    idioms:        [10,12],
    proverbs_intro:[10],               // pazhamozhi
    culture:       [11],               // utsavam = festival
    places:        [12],               // vazhi = road
    feelings:      [7,9],
    media:         [9,10],
    conversation_2:[4,5,6,7,8,11,12],
    test_final:    [1,2,3,4,5,6,7,8,9,10,11,12],
    test:          [1,2,3,4,5,6,7,8,9,10,11,12],
  },
  advanced:{
    complex_sentences:[1,2],
    conditionals:  [2],
    passive:       [3],
    relative:      [1,3],
    reported:      [1,2,3],
    poetry:        [4,12],             // poetic devices
    ramayana:      [12,4],
    literature:    [7,11],             // bhaasha, vyaakaranam
    rhetoric:      [4,10],
    proverbs_adv:  [9,10],
    letters:       [5,6,8],            // purpose, context, essay
    business:      [5,6],
    academic:      [5,8,11],
    legal:         [3,10,11],
    journalism:    [6,7,9],
    dialects:      [7,11],
    sanskrit:      [10,11],
    debate:        [9],                // tharkam = debate
    humour:        [9,10],
    films:         [7,12],
    translation:   [7,11,12],
    nuance:        [5,6,7],
    story_writing: [7,8,12],
    speaking:      [9,11],
    realworld:     [1,2,3,4,5,6,7,8,9,10,11,12],
    test_final:    [1,2,3,4,5,6,7,8,9,10,11,12],
    test:          [1,2,3,4,5,6,7,8,9,10,11,12],
  }
};

/** Returns the subset of flashcards relevant to the current lesson topic.
 *  Falls back to all cards if topic not mapped. */
function getTopicCards(level, topic){
  const allCards=FLASHCARDS[level]||FLASHCARDS.basic;
  const ids=(TOPIC_CARDS[level]||{})[topic];
  if(!ids||!ids.length) return allCards;
  const filtered=allCards.filter(c=>ids.includes(c.id));
  return filtered.length ? filtered : allCards;
}

// ══ FINAL LEVEL TESTS — 50 flashcard questions each ══════════════════════════
const FINAL_TESTS={
  basic:[
    // ── Script & Vowels (Q1–12) ───────────────────────────────────────────────
    {id:1,front:"Which letter is this?\n അ",vowel:"അ",q:"'അ' sounds like…",opts:["aa in father","a in cup","i in bit","oo in food"],ans:1,back:"അ = 'a' like cup\nHindi: अ\nExample: അമ്മ (amma)"},
    {id:2,front:"Which letter is this?\n ആ",vowel:"ആ",q:"'ആ' is the __ vowel",opts:["Short a","Long aa","Short i","Long ee"],ans:1,back:"ആ = long 'aa'\nHindi: आ\nExample: ആന (aana - elephant)"},
    {id:3,front:"Which letter is this?\n ഇ",vowel:"ഇ",q:"'ഇ' sounds like…",opts:["ee in see","i in bit","u in put","e in bed"],ans:1,back:"ഇ = 'i' like bit\nHindi: इ\nExample: ഇല (ila - leaf)"},
    {id:4,front:"Which letter is this?\n ഈ",vowel:"ഈ",q:"'ഈ' is the __ form of ഇ",opts:["Short","Long","Same","Opposite"],ans:1,back:"ഈ = long 'ee'\nHindi: ई\nExample: ഈച്ച (iicha - fly)"},
    {id:5,front:"Which letter is this?\n ഉ",vowel:"ഉ",q:"'ഉ' sounds like…",opts:["u in put","oo in food","a in cup","i in bit"],ans:0,back:"ഉ = 'u' like put\nHindi: उ\nExample: ഉപ്പ് (uppu - salt)"},
    {id:6,front:"Which letter is this?\n ഊ",vowel:"ഊ",q:"'ഊ' sounds like…",opts:["u in put","oo in food","ee in see","a in cup"],ans:1,back:"ഊ = long 'oo'\nHindi: ऊ\nExample: ഊഞ്ഞാൽ (swing)"},
    {id:7,front:"Which letter is this?\n എ",vowel:"എ",q:"'എ' sounds like…",opts:["a in take","e in bed","i in bit","o in pot"],ans:1,back:"എ = 'e' like bed\nHindi: ए\nExample: എലി (eli - rat)"},
    {id:8,front:"Which letter is this?\n ഏ",vowel:"ഏ",q:"'ഏ' sounds like…",opts:["e in bed","a in take","i in bit","o in note"],ans:1,back:"ഏ = 'ay' like take\nHindi: ए (long)\nExample: ഏണി (eeni - ladder)"},
    {id:9,front:"Which consonant makes 'ka'?",vowel:"ക",q:"'ക' sounds like…",opts:["ga in gate","ka in kite","cha in chat","ta in tap"],ans:1,back:"ക = 'ka'\nLike k in kite\nExample: കണ്ണ് (eye)"},
    {id:10,front:"Which consonant makes 'ma'?",vowel:"മ",q:"'മ' sounds like…",opts:["na in name","ba in ball","ma in mother","la in lamp"],ans:2,back:"മ = 'ma'\nLike m in mother\nExample: മരം (maram - tree)"},
    {id:11,front:"How many vowels does Malayalam have?",vowel:"സ്വരം",q:"Total Malayalam vowels (Swarams):",opts:["10","11","13","16"],ans:2,back:"Malayalam has 13 vowels\nCalled Swarams\nFrom അ to അം"},
    {id:12,front:"'ക' + vowel sign 'ാ' = ?",vowel:"കാ",q:"ക + ാ equals…",opts:["കി","കാ","കൊ","കേ"],ans:1,back:"ക + ാ = കാ\nPronounced 'kaa'\nVowel signs = Matras"},
    // ── Numbers (Q13–20) ─────────────────────────────────────────────────────
    {id:13,front:"What number is ഒന്ന്?",vowel:"ഒന്ന്",q:"ഒന്ന് means…",opts:["Two","Three","One","Zero"],ans:2,back:"ഒന്ന് = One (1)\nPronounced: 'onnu'\nHindi: एक"},
    {id:14,front:"What number is രണ്ട്?",vowel:"രണ്ട്",q:"രണ്ട് means…",opts:["One","Two","Three","Four"],ans:1,back:"രണ്ട് = Two (2)\nPronounced: 'randu'\nHindi: दो"},
    {id:15,front:"What number is മൂന്ന്?",vowel:"മൂന്ന്",q:"മൂന്ന് means…",opts:["Two","Four","Three","Five"],ans:2,back:"മൂന്ന് = Three (3)\nPronounced: 'moonnu'\nHindi: तीन"},
    {id:16,front:"What number is നാല്?",vowel:"നാല്",q:"നാല് means…",opts:["Three","Four","Five","Six"],ans:1,back:"നാല് = Four (4)\nPronounced: 'naalu'\nHindi: चार"},
    {id:17,front:"What number is അഞ്ച്?",vowel:"അഞ്ച്",q:"അഞ്ച് means…",opts:["Four","Six","Seven","Five"],ans:3,back:"അഞ്ച് = Five (5)\nPronounced: 'anchu'\nHindi: पाँच"},
    {id:18,front:"What number is പത്ത്?",vowel:"പത്ത്",q:"പത്ത് means…",opts:["Eight","Nine","Ten","Seven"],ans:2,back:"പത്ത് = Ten (10)\nPronounced: 'pathu'\nHindi: दस"},
    {id:19,front:"How do you say 20 in Malayalam?",vowel:"ഇരുപത്",q:"Twenty = ?",opts:["ഇരുപത്","പതിനഞ്ച്","ഇരുപത്തഞ്ച്","പതിനേഴ്"],ans:0,back:"ഇരുപത് = Twenty (20)\nPronounced: 'irupathu'\nPattern: iru + pathu"},
    {id:20,front:"How do you say 100 in Malayalam?",vowel:"നൂറ്",q:"One hundred = ?",opts:["ആയിരം","നൂറ്","അൻപത്","എഴുപത്"],ans:1,back:"നൂറ് = Hundred (100)\nPronounced: 'nooru'\nHindi: सौ"},
    // ── Colours & Nature (Q21–26) ────────────────────────────────────────────
    {id:21,front:"ചുവപ്പ് is what colour?",vowel:"ചുവപ്പ്",q:"ചുവപ്പ് means…",opts:["Blue","Green","Yellow","Red"],ans:3,back:"ചുവപ്പ് = Red\nPronounced: 'chuvappu'\nHindi: लाल"},
    {id:22,front:"നീല is what colour?",vowel:"നീല",q:"നീല means…",opts:["Red","Blue","Green","White"],ans:1,back:"നീല = Blue\nPronounced: 'neela'\nHindi: नीला"},
    {id:23,front:"പച്ച is what colour?",vowel:"പച്ച",q:"പച്ച means…",opts:["Yellow","Red","Green","Black"],ans:2,back:"പച്ച = Green\nPronounced: 'pacha'\nHindi: हरा"},
    {id:24,front:"What is 'elephant' in Malayalam?",vowel:"ആന",q:"ആന means…",opts:["Tiger","Elephant","Lion","Horse"],ans:1,back:"ആന = Elephant\nPronounced: 'aana'\nKerala's state animal!"},
    {id:25,front:"What is 'tree' in Malayalam?",vowel:"മരം",q:"മരം means…",opts:["Flower","River","Tree","Mountain"],ans:2,back:"മരം = Tree\nPronounced: 'maram'\nHindi: पेड़"},
    {id:26,front:"What is 'rain' in Malayalam?",vowel:"മഴ",q:"മഴ means…",opts:["Sun","Wind","Rain","Cloud"],ans:2,back:"മഴ = Rain\nPronounced: 'mazha'\nKerala has heavy monsoon rain!"},
    // ── Greetings & Family (Q27–34) ──────────────────────────────────────────
    {id:27,front:"How do you say 'hello' in Malayalam?",vowel:"നമസ്കാരം",q:"Hello = ?",opts:["നന്ദി","ക്ഷമിക്കൂ","നമസ്കാരം","ശരി"],ans:2,back:"നമസ്കാരം = Hello\nPronounced: 'namaskaram'\nHindi: नमस्ते"},
    {id:28,front:"How do you say 'thank you'?",vowel:"നന്ദി",q:"Thank you = ?",opts:["ശരി","നന്ദി","ക്ഷമിക്കൂ","നമസ്കാരം"],ans:1,back:"നന്ദി = Thank you\nPronounced: 'nandi'\nHindi: धन्यवाद"},
    {id:29,front:"How do you say 'sorry'?",vowel:"ക്ഷമിക്കൂ",q:"Sorry/Excuse me = ?",opts:["നന്ദി","ശരി","ക്ഷമിക്കൂ","നമസ്കാരം"],ans:2,back:"ക്ഷമിക്കൂ = Sorry\nPronounced: 'kshamikkoo'\nHindi: माफ़ करना"},
    {id:30,front:"'അമ്മ' means which family member?",vowel:"അമ്മ",q:"അമ്മ means…",opts:["Father","Sister","Brother","Mother"],ans:3,back:"അമ്മ = Mother\nPronounced: 'amma'\nHindi: माँ"},
    {id:31,front:"'അച്ഛൻ' means which family member?",vowel:"അച്ഛൻ",q:"അച്ഛൻ means…",opts:["Father","Mother","Brother","Uncle"],ans:0,back:"അച്ഛൻ = Father\nPronounced: 'achhan'\nHindi: पिता"},
    {id:32,front:"'ജ്യേഷ്ഠൻ' means…",vowel:"ജ്യേഷ്ഠൻ",q:"ജ്യേഷ്ഠൻ means…",opts:["Younger brother","Elder brother","Elder sister","Father"],ans:1,back:"ജ്യേഷ്ഠൻ = Elder brother\nPronounced: 'jyeshthan'\nHindi: बड़ा भाई"},
    {id:33,front:"'കുടുംബം' means…",vowel:"കുടുംബം",q:"കുടുംബം means…",opts:["House","School","Family","Friend"],ans:2,back:"കുടുംബം = Family\nPronounced: 'kudumbam'\nHindi: परिवार"},
    {id:34,front:"'ഭക്ഷണം' means…",vowel:"ഭക്ഷണം",q:"ഭക്ഷണം means…",opts:["Water","Food","Drink","Fruit"],ans:1,back:"ഭക്ഷണം = Food\nPronounced: 'bhakshanam'\nHindi: खाना"},
    // ── Days, Time & Places (Q35–42) ─────────────────────────────────────────
    {id:35,front:"'തിങ്കൾ' is which day?",vowel:"തിങ്കൾ",q:"തിങ്കൾ means…",opts:["Sunday","Tuesday","Monday","Wednesday"],ans:2,back:"തിങ്കൾ = Monday\nPronounced: 'thingal'\nHindi: सोमवार"},
    {id:36,front:"'ഞായർ' is which day?",vowel:"ഞായർ",q:"ഞായർ means…",opts:["Saturday","Sunday","Friday","Monday"],ans:1,back:"ഞായർ = Sunday\nPronounced: 'njaayar'\nHindi: रविवार"},
    {id:37,front:"'രാവിലെ' means…",vowel:"രാവിലെ",q:"രാവിലെ means…",opts:["Evening","Night","Afternoon","Morning"],ans:3,back:"രാവിലെ = Morning\nPronounced: 'raavile'\nHindi: सुबह"},
    {id:38,front:"'രാത്രി' means…",vowel:"രാത്രി",q:"രാത്രി means…",opts:["Morning","Afternoon","Evening","Night"],ans:3,back:"രാത്രി = Night\nPronounced: 'raathri'\nHindi: रात"},
    {id:39,front:"'വടക്ക്' means which direction?",vowel:"വടക്ക്",q:"വടക്ക് means…",opts:["South","East","West","North"],ans:3,back:"വടക്ക് = North\nPronounced: 'vadakku'\nHindi: उत्तर"},
    {id:40,front:"'ഇടത്ത്' means…",vowel:"ഇടത്ത്",q:"ഇടത്ത് means…",opts:["Right","Straight","Left","Back"],ans:2,back:"ഇടത്ത് = Left\nPronounced: 'idathu'\nHindi: बाएं"},
    {id:41,front:"'വില' means…",vowel:"വില",q:"വില means…",opts:["Quality","Price","Shop","Market"],ans:1,back:"വില = Price\nPronounced: 'vila'\nUsed in shopping"},
    {id:42,front:"'വാങ്ങുക' means…",vowel:"വാങ്ങുക",q:"വാങ്ങുക means…",opts:["To sell","To buy","To give","To take"],ans:1,back:"വാങ്ങുക = To buy\nPronounced: 'vaanguka'\nHindi: खरीदना"},
    // ── Pronouns, Verbs & Sentences (Q43–50) ─────────────────────────────────
    {id:43,front:"'ഞാൻ' means…",vowel:"ഞാൻ",q:"ഞാൻ means…",opts:["You","He","She","I"],ans:3,back:"ഞാൻ = I\nPronounced: 'njaan'\nHindi: मैं"},
    {id:44,front:"'നിങ്ങൾ' means…",vowel:"നിങ്ങൾ",q:"നിങ്ങൾ means…",opts:["I","He","You (formal)","They"],ans:2,back:"നിങ്ങൾ = You (formal/plural)\nPronounced: 'ningal'\nHindi: आप"},
    {id:45,front:"'അവൾ' means…",vowel:"അവൾ",q:"അവൾ means…",opts:["He","She","They","I"],ans:1,back:"അവൾ = She\nPronounced: 'aval'\nHindi: वह (female)"},
    {id:46,front:"'പോക' means which verb?",vowel:"പോക",q:"പോക means…",opts:["To come","To eat","To go","To sleep"],ans:2,back:"പോക = To go\nPronounced: 'poka'\nHindi: जाना"},
    {id:47,front:"'ഉണ്ണുക' means which verb?",vowel:"ഉണ്ണുക",q:"ഉണ്ണുക means…",opts:["To drink","To sleep","To run","To eat"],ans:3,back:"ഉണ്ണുക = To eat\nPronounced: 'unnuka'\nHindi: खाना"},
    {id:48,front:"'നല്ല' means…",vowel:"നല്ല",q:"നല്ല means…",opts:["Bad","Big","Small","Good"],ans:3,back:"നല്ല = Good\nPronounced: 'nalla'\nHindi: अच्छा"},
    {id:49,front:"'ഞാൻ __ ആണ്' completes a sentence meaning 'I am __'.",vowel:"ആണ്",q:"ആണ് is used to express…",opts:["A question","'I am / he is'","A negative","Past tense"],ans:1,back:"ആണ് = am/is/are\nഞാൻ Arjun ആണ് = I am Arjun\nKey linking verb"},
    {id:50,front:"'ഇത് എന്താണ്?' means…",vowel:"എന്ത്",q:"ഇത് എന്താണ്? means…",opts:["Who is this?","Where is this?","What is this?","How is this?"],ans:2,back:"ഇത് എന്താണ്? = What is this?\nPronounced: 'ithu enthaanu'\nHindi: यह क्या है?"},
  ],
  intermediate:[
    // ── Tenses (Q1–12) ────────────────────────────────────────────────────────
    {id:1,front:"'പോകുന്നു' — which tense?",vowel:"പോകുന്നു",q:"പോകുന്നു is in…",opts:["Past","Present","Future","Conditional"],ans:1,back:"പോകുന്നു = going (present)\nSuffix: -കുന്നു\nRoot: പോക (to go)"},
    {id:2,front:"'പോയി' — which tense?",vowel:"പോയി",q:"പോയി is in…",opts:["Present","Future","Past","Perfect"],ans:2,back:"പോയി = went (past)\nSimple past\nRoot: പോക (to go)"},
    {id:3,front:"'പോകും' — which tense?",vowel:"പോകും",q:"പോകും is in…",opts:["Past","Present","Future","Conditional"],ans:2,back:"പോകും = will go (future)\nSuffix: -ഉം\nRoot: പോക (to go)"},
    {id:4,front:"Present suffix for Malayalam verbs:",vowel:"-കുന്നു",q:"Present tense suffix is…",opts:["-ഉം","-ഇ","-കുന്നു","-ട്ടെ"],ans:2,back:"-കുന്നു = present tense\nEx: കഴിക്കുന്നു (eating)\nAdded to verb root"},
    {id:5,front:"Future suffix for Malayalam verbs:",vowel:"-ഉം",q:"Future tense suffix is…",opts:["-ഉം","-ഇ","-കുന്നു","-ട്ടെ"],ans:0,back:"-ഉം = future tense\nEx: കഴിക്കും (will eat)\nAdded to verb root"},
    {id:6,front:"'കഴിച്ചു' is in which tense?",vowel:"കഴിച്ചു",q:"കഴിച്ചു (ate) is in…",opts:["Present","Future","Past","Conditional"],ans:2,back:"കഴിച്ചു = ate (past)\nRoot: കഴിക്കുക (to eat)\nIrregular past form"},
    {id:7,front:"'ഇല്ല' is used for…",vowel:"ഇല്ല",q:"ഇല്ല means…",opts:["Yes","Please","Not/No","Because"],ans:2,back:"ഇല്ല = not / no\nPronounced: 'illa'\nUsed for negation"},
    {id:8,front:"'വരും' means…",vowel:"വരും",q:"വരും means…",opts:["Came","Coming","Will come","Come!"],ans:2,back:"വരും = will come (future)\nRoot: വരിക (to come)\nHindi: आएगा"},
    {id:9,front:"'ആകും' means…",vowel:"ആകും",q:"ആകും means…",opts:["Was","Is","Will be","Were"],ans:2,back:"ആകും = will be\nFuture of ആകുക\nHindi: होगा"},
    {id:10,front:"'ഉണ്ടായിരുന്നു' expresses…",vowel:"ഉണ്ടായിരുന്നു",q:"ഉണ്ടായിരുന്നു means…",opts:["Will exist","Exists","Existed / Was there","Does not exist"],ans:2,back:"ഉണ്ടായിരുന്നു = existed / was there\nPast continuous/habitual\nHindi: था / थी"},
    {id:11,front:"'എന്ത്' is used to ask…",vowel:"എന്ത്",q:"എന്ത് means…",opts:["Who","Where","When","What"],ans:3,back:"എന്ത് = What\nPronounced: 'enthu'\nHindi: क्या"},
    {id:12,front:"'എവിടെ' is used to ask…",vowel:"എവിടെ",q:"എവിടെ means…",opts:["What","When","Where","Who"],ans:2,back:"എവിടെ = Where\nPronounced: 'evidey'\nHindi: कहाँ"},
    // ── Vocabulary (Q13–26) ────────────────────────────────────────────────────
    {id:13,front:"'ആശുപത്രി' means…",vowel:"ആശുപത്രി",q:"ആശുപത്രി means…",opts:["School","Market","Hospital","Temple"],ans:2,back:"ആശുപത്രി = Hospital\nPronounced: 'aashupathri'\nHindi: अस्पताल"},
    {id:14,front:"'ചന്ത' means…",vowel:"ചന്ത",q:"ചന്ത means…",opts:["Temple","Hospital","School","Market"],ans:3,back:"ചന്ത = Market\nPronounced: 'chantha'\nHindi: बाज़ार"},
    {id:15,front:"'ദയവായി' means…",vowel:"ദയവായി",q:"ദയവായി means…",opts:["Thank you","Sorry","Please","Goodbye"],ans:2,back:"ദയവായി = Please\nPronounced: 'dayavayi'\nUsed for polite requests"},
    {id:16,front:"'മഴ' means…",vowel:"മഴ",q:"മഴ means…",opts:["Sun","Wind","Cloud","Rain"],ans:3,back:"മഴ = Rain\nPronounced: 'mazha'\nKerala's famous monsoon"},
    {id:17,front:"'വേദന' means…",vowel:"വേദന",q:"വേദന means…",opts:["Joy","Hunger","Pain","Thirst"],ans:2,back:"വേദന = Pain\nPronounced: 'vedana'\nHindi: दर्द"},
    {id:18,front:"'ഡോക്ടർ' means…",vowel:"ഡോക്ടർ",q:"ഡോക്ടർ means…",opts:["Teacher","Nurse","Engineer","Doctor"],ans:3,back:"ഡോക്ടർ = Doctor\nPronounced: 'doktar'\nLoanword from English"},
    {id:19,front:"'യാത്ര' means…",vowel:"യാത്ര",q:"യാത്ര means…",opts:["Rest","Work","Journey","Home"],ans:2,back:"യാത്ര = Journey/Travel\nPronounced: 'yaathra'\nHindi: यात्रा"},
    {id:20,front:"'ഉത്സവം' means…",vowel:"ഉത്സവം",q:"ഉത്സവം means…",opts:["Work","Temple","Festival","Prayer"],ans:2,back:"ഉത്സവം = Festival\nPronounced: 'utsavam'\nOnam & Vishu are Kerala festivals"},
    {id:21,front:"'പഴമൊഴി' means…",vowel:"പഴമൊഴി",q:"പഴമൊഴി means…",opts:["Song","Drama","Story","Proverb"],ans:3,back:"പഴമൊഴി = Proverb\nPronounced: 'pazhamozhi'\nAncient wisdom in short sayings"},
    {id:22,front:"'സമ്മതം' means…",vowel:"സമ്മതം",q:"സമ്മതം means…",opts:["Disagreement","Question","Agreement","Request"],ans:2,back:"സമ്മതം = Agreement\nPronounced: 'sammtham'\nHindi: सहमति"},
    {id:23,front:"'വഴി' means…",vowel:"വഴി",q:"വഴി means…",opts:["River","Mountain","Sea","Road/Way"],ans:3,back:"വഴി = Road / Way\nPronounced: 'vazhi'\nHindi: रास्ता"},
    {id:24,front:"'സന്തോഷം' means…",vowel:"സന്തോഷം",q:"സന്തോഷം means…",opts:["Sadness","Anger","Fear","Happiness"],ans:3,back:"സന്തോഷം = Happiness\nPronounced: 'santhosham'\nHindi: खुशी"},
    {id:25,front:"'ദുഃഖം' means…",vowel:"ദുഃഖം",q:"ദുഃഖം means…",opts:["Joy","Anger","Sadness","Love"],ans:2,back:"ദുഃഖം = Sadness\nPronounced: 'duhkham'\nHindi: दुख"},
    {id:26,front:"'വാർത്ത' means…",vowel:"വാർത്ത",q:"വാർത്ത means…",opts:["Story","Song","Book","News"],ans:3,back:"വാർത്ത = News\nPronounced: 'vaarttha'\nHindi: समाचार"},
    // ── Grammar & Postpositions (Q27–38) ──────────────────────────────────────
    {id:27,front:"The postposition 'ൽ/ിൽ' means…",vowel:"ൽ",q:"ൽ/ിൽ means…",opts:["From","To","In/At","With"],ans:2,back:"ൽ / ിൽ = in / at\nEx: വീട്ടിൽ = at home\nHindi: में"},
    {id:28,front:"The postposition 'ക്ക്' means…",vowel:"ക്ക്",q:"ക്ക് means…",opts:["In","From","With","To/For"],ans:3,back:"ക്ക് = to / for\nEx: എനിക്ക് = for me\nHindi: को / के लिए"},
    {id:29,front:"The postposition 'നിന്ന്' means…",vowel:"നിന്ന്",q:"നിന്ന് means…",opts:["With","To","In","From"],ans:3,back:"നിന്ന് = from\nEx: കേരളത്തിൽ നിന്ന് = from Kerala\nHindi: से"},
    {id:30,front:"'ഞാൻ പോകുന്നില്ല' means…",vowel:"ഇല്ല",q:"This sentence means…",opts:["I go","I went","I will go","I don't go"],ans:3,back:"ഞാൻ പോകുന്നില്ല = I don't go\nNegation: -ഇല്ല added\nHindi: मैं नहीं जाता"},
    {id:31,front:"'ദയവായി സഹായിക്കൂ' means…",vowel:"സഹായിക്കൂ",q:"This phrase means…",opts:["Please come","Please help","Please go","Please wait"],ans:1,back:"ദയവായി സഹായിക്കൂ = Please help\nദയവായി = please\nസഹായിക്കൂ = help"},
    {id:32,front:"'ആകുമോ?' is used to ask…",vowel:"ആകുമോ",q:"ആകുമോ? means…",opts:["Will it be done?","Is it done?","It is done","It was done"],ans:0,back:"ആകുമോ? = Is it possible? / Will it be?\nPolite request form\nHindi: होगा क्या?"},
    {id:33,front:"Compound word: ആകാശ + ഗംഗ = ?",vowel:"ആകാശഗംഗ",q:"ആകാശഗംഗ means…",opts:["Blue sky","Milky Way","Rain cloud","River bank"],ans:1,back:"ആകാശഗംഗ = Milky Way\nആകാശ = sky\nഗംഗ = Ganga"},
    {id:34,front:"'കണ്ണ് തുറക്കുക' as an idiom means…",vowel:"കണ്ണ് തുറക്കുക",q:"This idiom means…",opts:["To open a window","To wake up","To realize/become aware","To read"],ans:2,back:"കണ്ണ് തുറക്കുക = To realize\nLiteral: open your eyes\nUsed figuratively"},
    {id:35,front:"'ഔപചാരിക' means…",vowel:"ഔപചാരിക",q:"ഔപചാരിക means…",opts:["Informal","Casual","Formal","Spoken"],ans:2,back:"ഔപചാരിക = Formal\nPronounced: 'oupacharika'\nUsed in official contexts"},
    {id:36,front:"'അഭിപ്രായം' means…",vowel:"അഭിപ്രായം",q:"അഭിപ്രായം means…",opts:["Question","Answer","Opinion","Doubt"],ans:2,back:"അഭിപ്രായം = Opinion\nPronounced: 'abhipraayam'\nHindi: राय"},
    {id:37,front:"'ഒരു നിമിഷം' means…",vowel:"ഒരു നിമിഷം",q:"ഒരു നിമിഷം means…",opts:["One hour","One day","One moment","One week"],ans:2,back:"ഒരു നിമിഷം = One moment\nPronounced: 'oru nimisham'\nHindi: एक पल"},
    {id:38,front:"'കാരണം' is a connector meaning…",vowel:"കാരണം",q:"കാരണം means…",opts:["Then","After that","Finally","Because"],ans:3,back:"കാരണം = Because\nPronounced: 'kaaranam'\nHindi: क्योंकि"},
    // ── Culture & Advanced Vocab (Q39–50) ─────────────────────────────────────
    {id:39,front:"'ഓണം' is which type of event?",vowel:"ഓണം",q:"ഓണം is…",opts:["A food","A river","A Kerala harvest festival","A dance"],ans:2,back:"ഓണം = Onam\nKerala's biggest harvest festival\nCelebrated in August/September"},
    {id:40,front:"'കഥകളി' is…",vowel:"കഥകളി",q:"കഥകളി is a…",opts:["Type of food","Classical dance form","Festival","Language"],ans:1,back:"കഥകളി = Classical Kerala dance\nKatha = story\nKali = play/performance"},
    {id:41,front:"'കായൽ' means…",vowel:"കായൽ",q:"കായൽ means…",opts:["Mountain","Desert","Backwater/Lagoon","Forest"],ans:2,back:"കായൽ = Backwater/Lagoon\nPronounced: 'kaayil'\nKerala is famous for its backwaters"},
    {id:42,front:"'അതിനുശേഷം' means…",vowel:"അതിനുശേഷം",q:"അതിനുശേഷം means…",opts:["Before that","Because","After that","Finally"],ans:2,back:"അതിനുശേഷം = After that\nNarrative connector\nHindi: उसके बाद"},
    {id:43,front:"'ഒടുവിൽ' means…",vowel:"ഒടുവിൽ",q:"ഒടുവിൽ means…",opts:["Firstly","Before","In the middle","Finally"],ans:3,back:"ഒടുവിൽ = Finally\nPronounced: 'oduvil'\nHindi: अंत में"},
    {id:44,front:"'ടിക്കറ്റ്' means…",vowel:"ടിക്കറ്റ്",q:"ടിക്കറ്റ് means…",opts:["Train","Bus","Ticket","Station"],ans:2,back:"ടിക്കറ്റ് = Ticket\nPronounced: 'tikkat'\nLoanword from English"},
    {id:45,front:"'ഡോക്ടർ, എനിക്ക് വേദനയുണ്ട്' means…",vowel:"വേദനയുണ്ട്",q:"This sentence means…",opts:["Doctor, I have a fever","Doctor, I have pain","Doctor, I need medicine","Doctor, I am fine"],ans:1,back:"ഡോക്ടർ, എനിക്ക് വേദനയുണ്ട് = Doctor, I have pain\nവേദന = pain\nഉണ്ട് = there is/I have"},
    {id:46,front:"'ഇത് എത്ര?' means…",vowel:"എത്ര",q:"ഇത് എത്ര? means…",opts:["What is this?","Is this good?","How much is this?","Where is this?"],ans:2,back:"ഇത് എത്ര? = How much is this?\nUsed while shopping\nHindi: यह कितने का है?"},
    {id:47,front:"'സ്നേഹം' means…",vowel:"സ്നേഹം",q:"സ്നേഹം means…",opts:["Hatred","Anger","Fear","Love"],ans:3,back:"സ്നേഹം = Love\nPronounced: 'sneham'\nHindi: प्यार"},
    {id:48,front:"'ഭയം' means…",vowel:"ഭയം",q:"ഭയം means…",opts:["Love","Joy","Fear","Anger"],ans:2,back:"ഭയം = Fear\nPronounced: 'bhayam'\nHindi: डर"},
    {id:49,front:"'ദേഷ്യം' means…",vowel:"ദേഷ്യം",q:"ദേഷ്യം means…",opts:["Sadness","Anger","Fear","Joy"],ans:1,back:"ദേഷ്യം = Anger\nPronounced: 'deshyam'\nHindi: गुस्सा"},
    {id:50,front:"'ഞാൻ കേരളത്തിൽ നിന്ന് വന്നു' means…",vowel:"കേരളം",q:"This sentence means…",opts:["I am going to Kerala","I live in Kerala","I came from Kerala","I like Kerala"],ans:2,back:"ഞാൻ കേരളത്തിൽ നിന്ന് വന്നു = I came from Kerala\nനിന്ന് = from\nവന്നു = came"},
  ],
  advanced:[
    // ── Complex Grammar (Q1–14) ────────────────────────────────────────────────
    {id:1,front:"'ആകുമായിരുന്നു' expresses…",vowel:"ആകുമായിരുന്നു",q:"This form expresses…",opts:["Simple past","Present continuous","Conditional past","Future"],ans:2,back:"ആകുമായിരുന്നു = would have been\nCounterfactual conditional\nExpresses unrealised past"},
    {id:2,front:"'കർമ്മവാചകം' means…",vowel:"കർമ്മവാചകം",q:"കർമ്മവാചകം means…",opts:["Active voice","Passive voice","Question form","Negative"],ans:1,back:"കർമ്മവാചകം = Passive voice\nKarma = object\nVaachakam = voice"},
    {id:3,front:"Passive suffix in Malayalam:",vowel:"-പ്പെടുന്നു",q:"The passive voice suffix is…",opts:["-കുന്നു","-ഇ","-പ്പെടുന്നു","-ഉം"],ans:2,back:"-പ്പെടുന്നു = passive suffix\nEx: ചെയ്യുന്നു → ചെയ്യപ്പെടുന്നു\n(does → is done)"},
    {id:4,front:"'ആണെങ്കിൽ' means…",vowel:"ആണെങ്കിൽ",q:"ആണെങ്കിൽ means…",opts:["Although","If it is","Because","When"],ans:1,back:"ആണെങ്കിൽ = if it is\nConditional connector\nHindi: अगर है तो"},
    {id:5,front:"'ആയിരുന്നെങ്കിൽ' expresses…",vowel:"ആയിരുന്നെങ്കിൽ",q:"This expresses…",opts:["Real condition","Unreal/past condition","Future wish","Command"],ans:1,back:"ആയിരുന്നെങ്കിൽ = if it were\nUnreal conditional (past)\nHindi: अगर होता"},
    {id:6,front:"Relative clause suffix '-ക്കുന്ന' is used to…",vowel:"-ക്കുന്ന",q:"'-ക്കുന്ന' turns a verb into…",opts:["A past form","A noun","A relative modifier","A question"],ans:2,back:"-ക്കുന്ന = relative participle\nEx: പോകുന്ന ആൾ = the person who goes\nVerb becomes modifier"},
    {id:7,front:"'-എന്ന്' is used for…",vowel:"-എന്ന്",q:"'-എന്ന്' connects…",opts:["Two nouns","Reported speech/that","Two verbs","Subject and object"],ans:1,back:"-എന്ന് = that / saying\nUsed in reported speech\nEx: അവൻ പോകും എന്ന് പറഞ്ഞു (said that he will go)"},
    {id:8,front:"'കർത്തൃവാചകം' means…",vowel:"കർത്തൃവാചകം",q:"കർത്തൃവാചകം means…",opts:["Passive voice","Active voice","Question form","Negative form"],ans:1,back:"കർത്തൃവാചകം = Active voice\nKartha = subject/doer\nOpposite of passive"},
    {id:9,front:"'ദ്വന്ദ്വം' in grammar refers to…",vowel:"ദ്വന്ദ്വം",q:"ദ്വന്ദ്വം refers to…",opts:["Single words","Compound/Dual forms","Verb forms","Suffixes"],ans:1,back:"ദ്വന്ദ്വം = Compound/Dual\nSanskrit-origin term\nUsed in advanced compound words"},
    {id:10,front:"'ഉദ്ദേശ്യം' means…",vowel:"ഉദ്ദേശ്യം",q:"ഉദ്ദേശ്യം means…",opts:["Result","Method","Doubt","Purpose/Intention"],ans:3,back:"ഉദ്ദേശ്യം = Purpose/Intention\nPronounced: 'uddesyam'\nUsed in formal writing"},
    {id:11,front:"'സന്ദർഭം' means…",vowel:"സന്ദർഭം",q:"സന്ദർഭം means…",opts:["Sentence","Grammar","Context/Occasion","Paragraph"],ans:2,back:"സന്ദർഭം = Context\nPronounced: 'sandarbham'\nCritical for understanding nuance"},
    {id:12,front:"'തർക്കം' means…",vowel:"തർക്കം",q:"തർക്കം means…",opts:["Agreement","Silence","Question","Debate/Argument"],ans:3,back:"തർക്കം = Debate\nPronounced: 'tharkam'\nUsed in academic debates"},
    {id:13,front:"'വ്യാകരണം' means…",vowel:"വ്യാകരണം",q:"വ്യാകരണം means…",opts:["Literature","Dictionary","Script","Grammar"],ans:3,back:"വ്യാകരണം = Grammar\nPronounced: 'vyaakaranam'\nRules of the language"},
    {id:14,front:"'ഭാഷ' means…",vowel:"ഭാഷ",q:"ഭാഷ means…",opts:["Culture","Literature","Grammar","Language"],ans:3,back:"ഭാഷ = Language\nPronounced: 'bhaasha'\nMalayalam = one of India's classical languages"},
    // ── Literature & Poetry (Q15–26) ──────────────────────────────────────────
    {id:15,front:"'കിളിപ്പാട്ട്' is…",vowel:"കിളിപ്പാട്ട്",q:"കിളിപ്പാട്ട് is…",opts:["A dance form","A classical poetic form","A festival","A food"],ans:1,back:"കിളിപ്പാട്ട് = Classical poetic form\nBird-song style narration\nUsed in Adhyatma Ramayanam"},
    {id:16,front:"'ആശ്ലേഷം' as a literary device means…",vowel:"ആശ്ലേഷം",q:"ആശ്ലേഷം is a…",opts:["Grammar rule","Type of verb","Poetic device","Suffix"],ans:2,back:"ആശ്ലേഷം = Poetic device\nPersonification/Alliteration\nUsed in classical Malayalam poetry"},
    {id:17,front:"'ഉപമ' is which literary device?",vowel:"ഉപമ",q:"ഉപമ means…",opts:["Metaphor","Simile","Alliteration","Personification"],ans:1,back:"ഉപമ = Simile\nComparison using 'like' or 'as'\nEx: as white as a swan"},
    {id:18,front:"'രൂപകം' is which literary device?",vowel:"രൂപകം",q:"രൂപകം means…",opts:["Simile","Alliteration","Metaphor","Personification"],ans:2,back:"രൂപകം = Metaphor\nDirect comparison without 'like'\nHindi: रूपक"},
    {id:19,front:"'അനുപ്രാസം' is which literary device?",vowel:"അനുപ്രാസം",q:"അനുപ്രാസം means…",opts:["Simile","Metaphor","Personification","Alliteration"],ans:3,back:"അനുപ്രാസം = Alliteration\nRepetition of initial sounds\nCommon in Malayalam poetry"},
    {id:20,front:"Thunchaththu Ezhuthachan is known as…",vowel:"തുഞ്ചൻ",q:"Ezhuthachan is called…",opts:["First modern poet","Father of Malayalam","First novelist","First journalist"],ans:1,back:"Thunchaththu Ezhuthachan = Father of Malayalam\nWrote Adhyatma Ramayanam\nIn Kilipattu style"},
    {id:21,front:"G. Sankara Kurup won which award?",vowel:"സാഹിത്യ",q:"G. Sankara Kurup won the first…",opts:["Nobel Prize","Booker Prize","Jnanpith Award","Sahitya Akademi"],ans:2,back:"G. Sankara Kurup won first Jnanpith (1965)\nFor Malayalam literature\nPoet and writer"},
    {id:22,front:"'പ്രബന്ധം' means…",vowel:"പ്രബന്ധം",q:"പ്രബന്ധം means…",opts:["Story","Poem","Letter","Essay/Dissertation"],ans:3,back:"പ്രബന്ധം = Essay/Dissertation\nFormal academic writing\nHindi: निबंध"},
    {id:23,front:"'വൃത്തം' in Malayalam poetry means…",vowel:"വൃത്തം",q:"വൃത്തം means…",opts:["Rhyme","Simile","Meter/Rhythm","Alliteration"],ans:2,back:"വൃത്തം = Meter/Rhythm\nThe rhythmic pattern in poetry\nHindi: छंद"},
    {id:24,front:"'ആലങ്കാരം' means…",vowel:"ആലങ്കാരം",q:"ആലങ്കാരം means…",opts:["Grammar rule","Poetic device/Figure of speech","Verb form","Noun class"],ans:1,back:"ആലങ്കാരം = Figure of speech\nAlso: poetic ornament\nHindi: अलंकार"},
    {id:25,front:"'മണിപ്രവാളം' refers to…",vowel:"മണിപ്രവാളം",q:"മണിപ്രവാളം is…",opts:["A dance form","A mixed Sanskrit-Malayalam literary style","A festival","A food"],ans:1,back:"മണിപ്രവാളം = Mixed style\nMani (Sanskrit) + Pravalam (Malayalam)\nClassical literary tradition"},
    {id:26,front:"Vaikom Muhammad Basheer is known for…",vowel:"ബഷീർ",q:"Basheer's writing style is called…",opts:["Formal classical","Academic","Simple humanist prose","Epic poetry"],ans:2,back:"Basheer = simple humanist prose\nWrote about common people\nPioneering Malayalam author"},
    // ── Formal, Business & Professional (Q27–38) ──────────────────────────────
    {id:27,front:"'ബഹുമാനപ്പെട്ട' means…",vowel:"ബഹുമാനപ്പെട്ട",q:"ബഹുമാനപ്പെട്ട means…",opts:["Dear (informal)","Respected/Honourable","Hello","Yours faithfully"],ans:1,back:"ബഹുമാനപ്പെട്ട = Respected/Honourable\nUsed in formal letters\nHindi: माननीय"},
    {id:28,front:"'വിനീതൻ' at letter end means…",vowel:"വിനീതൻ",q:"'വിനീതൻ' is used as…",opts:["From","Regards","Yours obediently","Dear sir"],ans:2,back:"വിനീതൻ = Yours obediently\nFormal letter closing (male)\nHindi: आपका आज्ञाकारी"},
    {id:29,front:"'ചർച്ച' means…",vowel:"ചർച്ച",q:"ചർച്ച means…",opts:["Agreement","Discussion/Meeting","Debate","Letter"],ans:1,back:"ചർച്ച = Discussion/Meeting\nPronounced: 'charcha'\nHindi: चर्चा"},
    {id:30,front:"'ഉദ്യോഗം' means…",vowel:"ഉദ്യോഗം",q:"ഉദ്യോഗം means…",opts:["Education","Festival","Job/Employment","Family"],ans:2,back:"ഉദ്യോഗം = Job/Employment\nPronounced: 'udyogam'\nHindi: नौकरी"},
    {id:31,front:"'ന്യായം' means…",vowel:"ന്യായം",q:"ന്യായം means…",opts:["Doubt","Truth/Justice/Reason","Question","Agreement"],ans:1,back:"ന്യായം = Justice/Reason\nPronounced: 'nyaayam'\nHindi: न्याय"},
    {id:32,front:"'ഔദ്യോഗിക ഭാഷ' means…",vowel:"ഔദ്യോഗിക",q:"ഔദ്യോഗിക ഭാഷ means…",opts:["Literary language","Spoken dialect","Official language","Classical language"],ans:2,back:"ഔദ്യോഗിക ഭാഷ = Official language\nഔദ്യോഗിക = official\nHindi: राजभाषा"},
    {id:33,front:"'തലക്കെട്ട്' in journalism means…",vowel:"തലക്കെട്ട്",q:"തലക്കെട്ട് means…",opts:["Article body","Conclusion","Headline","Opinion"],ans:2,back:"തലക്കെട്ട് = Headline\nPronounced: 'thalakkettu'\nHindi: शीर्षक"},
    {id:34,front:"'ഉത്തരവ്' means…",vowel:"ഉത്തരവ്",q:"ഉത്തരവ് means…",opts:["Question","Order/Official directive","Agreement","Letter"],ans:1,back:"ഉത്തരവ് = Order/Official directive\nUsed in legal and government contexts\nHindi: आदेश"},
    {id:35,front:"'സംശയം' means…",vowel:"സംശയം",q:"സംശയം means…",opts:["Agreement","Knowledge","Doubt","Certainty"],ans:2,back:"സംശയം = Doubt\nPronounced: 'samshayam'\nHindi: संदेह"},
    {id:36,front:"'വിദ്യാഭ്യാസം' means…",vowel:"വിദ്യാഭ്യാസം",q:"വിദ്യാഭ്യാസം means…",opts:["Employment","Festival","Family","Education"],ans:3,back:"വിദ്യാഭ്യാസം = Education\nPronounced: 'vidyaabhyaasam'\nHindi: शिक्षा"},
    {id:37,front:"'തർക്കശാസ്ത്രം' means…",vowel:"തർക്കശാസ്ത്രം",q:"തർക്കശാസ്ത്രം means…",opts:["Grammar","Literature","Logic/Debate science","History"],ans:2,back:"തർക്കശാസ്ത്രം = Logic/Debate science\nTarkam = debate\nShaastram = science"},
    {id:38,front:"'ഭരണഘടന' means…",vowel:"ഭരണഘടന",q:"ഭരണഘടന means…",opts:["Government","Ministry","Constitution","Parliament"],ans:2,back:"ഭരണഘടന = Constitution\nPronounced: 'bharanaghadana'\nHindi: संविधान"},
    // ── Dialects, Sanskrit & Mastery (Q39–50) ─────────────────────────────────
    {id:39,front:"'തൽസമം' refers to…",vowel:"തൽസമം",q:"Tatsama words are…",opts:["Pure Malayalam words","Sanskrit loanwords unchanged in Malayalam","Tamil loanwords","English loanwords"],ans:1,back:"തൽസമം (Tatsama) = Sanskrit words unchanged\nEx: ക്ഷേത്രം (temple) unchanged from Sanskrit\nOpposite of Tadbhava"},
    {id:40,front:"'തദ്ഭവം' refers to…",vowel:"തദ്ഭവം",q:"Tadbhava words are…",opts:["Sanskrit words unchanged","Sanskrit-derived words adapted to Malayalam","English words","New words"],ans:1,back:"തദ്ഭവം (Tadbhava) = Sanskrit-derived but changed\nEx: Sanskrit ക്ഷീരം → Malayalam പാൽ (milk)\nEvolved form"},
    {id:41,front:"Kozhikode dialect is influenced by…",vowel:"കോഴിക്കോട്",q:"Kozhikode Malayalam shows influence from…",opts:["Tamil","Tulu","Arabic/Persian","Kannada"],ans:2,back:"Kozhikode dialect has Arabic/Persian influence\nDue to Arab trade connections\nNorthern Kerala dialect"},
    {id:42,front:"'ഹാസ്യം' means…",vowel:"ഹാസ്യം",q:"ഹാസ്യം means…",opts:["Sadness","Anger","Humour/Comedy","Fear"],ans:2,back:"ഹാസ്യം = Humour/Comedy\nPronounced: 'haasyam'\nHindi: हास्य"},
    {id:43,front:"'വ്യംഗ്യം' as a literary term means…",vowel:"വ്യംഗ്യം",q:"വ്യംഗ്യം means…",opts:["Direct statement","Irony/Satire","Simile","Alliteration"],ans:1,back:"വ്യംഗ്യം = Irony/Satire\nImplied meaning behind words\nHindi: व्यंग्य"},
    {id:44,front:"'തർജ്ജമ' means…",vowel:"തർജ്ജമ",q:"തർജ്ജമ means…",opts:["Original text","Summary","Translation","Commentary"],ans:2,back:"തർജ്ജമ = Translation\nPronounced: 'tharjjama'\nHindi: अनुवाद"},
    {id:45,front:"'നൂതന' means…",vowel:"നൂതന",q:"നൂതന means…",opts:["Ancient","Old","Modern/New","Classical"],ans:2,back:"നൂതന = Modern/New\nPronounced: 'noothana'\nHindi: नवीन"},
    {id:46,front:"'ക്ഷേത്രം' is a Tatsama word meaning…",vowel:"ക്ഷേത്രം",q:"ക്ഷേത്രം means…",opts:["School","Hospital","Field/Temple","Market"],ans:2,back:"ക്ഷേത്രം = Temple/Field\nSanskrit loanword (unchanged)\nHindi: क्षेत्र"},
    {id:47,front:"'പ്രഭാഷണം' means…",vowel:"പ്രഭാഷണം",q:"പ്രഭാഷണം means…",opts:["Writing","Reading","Singing","Speech/Lecture"],ans:3,back:"പ്രഭാഷണം = Speech/Lecture\nPronounced: 'prabhaashan'\nHindi: भाषण"},
    {id:48,front:"'ആഖ്യാനം' means…",vowel:"ആഖ്യാനം",q:"ആഖ്യാനം means…",opts:["Poem","Narration/Story","Grammar","Translation"],ans:1,back:"ആഖ്യാനം = Narration/Story\nPronounced: 'aakhyaanam'\nHindi: आख्यान"},
    {id:49,front:"'നിഗമനം' means…",vowel:"നിഗമനം",q:"നിഗമനം means…",opts:["Introduction","Argument","Conclusion","Evidence"],ans:2,back:"നിഗമനം = Conclusion\nPronounced: 'nigamanam'\nHindi: निष्कर्ष"},
    {id:50,front:"'ആദ്യം…പിന്നെ…ഒടുവിൽ' is used for…",vowel:"ആദ്യം",q:"These words are used to…",opts:["Ask questions","Express emotions","Structure a narrative","Form negatives"],ans:2,back:"ആദ്യം=first, പിന്നെ=then, ഒടുവിൽ=finally\nNarrative structure connectors\nUsed in storytelling"},
  ]
};

// ══ SYSTEM MESSAGES PER LEVEL & TOPIC ════════════════════════════════════════
function getSystemMsg(level, day, topic, studentName){
  const base=`You are Meera Teacher, warm and encouraging Malayalam tutor. Student: ${studentName}.

PRONUNCIATION RULES:
- Always give: [LETTER/WORD] — pronounced "[SOUND]" — Hindi: [HINDI]
- Explain mouth position for new sounds. Use English phonetics + Hindi comparisons.
- After every 2-3 items say "🔊 Repeat after me:" with a phonetic drill.

QUIZ RULE:
- NEVER write quiz questions or multiple-choice options in your chat text. NEVER.
- Do NOT write "Quiz:", "A)", "B)", "Which letter...", etc.
- The app has a built-in 🃏 Flashcard Quiz button on every message — the student taps it when ready.
- Just teach the content clearly. Quizzes are handled by the app's flashcard system.

`;
  const topics={
    // BASIC
    vowels:`${base}LEVEL: Basic — Day 1. Teach all 13 Malayalam Vowels (Swarams). Teach in pairs with Hindi comparison.`,
    consonants_1:`${base}LEVEL: Basic — Day 2. Teach consonants ക,ഖ,ഗ,ഘ,ങ,ച,ഛ,ജ,ഝ,ഞ,ട,ഠ,ഡ,ഢ,ണ with pronunciation guides.`,
    consonants_2:`${base}LEVEL: Basic — Day 3. Teach consonants ത,ഥ,ദ,ധ,ന,പ,ഫ,ബ,ഭ,മ with examples and pronunciation.`,
    consonants_3:`${base}LEVEL: Basic — Day 4. Teach consonants യ,ര,ല,വ,ശ,ഷ,സ,ഹ,ള,ഴ,റ with pronunciation.`,
    matras:`${base}LEVEL: Basic — Day 5. Teach vowel signs (matras/chihnam) — how vowels attach to consonants. Give visual examples like ക+ാ=കാ.`,
    numbers_1:`${base}LEVEL: Basic — Day 7. Teach numbers 1-10 in Malayalam with pronunciation: ഒന്ന്(1), രണ്ട്(2), മൂന്ന്(3), നാല്(4), അഞ്ച്(5), ആറ്(6), ഏഴ്(7), എട്ട്(8), ഒമ്പത്(9), പത്ത്(10).`,
    numbers_2:`${base}LEVEL: Basic — Day 8. Teach numbers 11-100. Explain patterns like -padhinoru(11), -irupathu(20) etc.`,
    colors:`${base}LEVEL: Basic — Day 9. Teach colours: ചുവപ്പ്(red), നീല(blue), പച്ച(green), മഞ്ഞ(yellow), വെള്ള(white), കറുപ്പ്(black), ഓറഞ്ച്(orange).`,
    body:`${base}LEVEL: Basic — Day 10. Teach body parts: തല(head), കണ്ണ്(eye), കൈ(hand), കാല്(foot), വായ(mouth), ചെവി(ear), മൂക്ക്(nose).`,
    animals:`${base}LEVEL: Basic — Day 11. Teach animals & nature: ആന(elephant), കടുവ(tiger), മരം(tree), പൂ(flower), നദി(river), മഴ(rain).`,
    greetings:`${base}LEVEL: Basic — Day 13. Teach greetings: നമസ്കാരം(hello), നന്ദി(thank you), ക്ഷമിക്കൂ(sorry), ശരി(okay), എങ്ങനെ ഉണ്ട്(how are you).`,
    family:`${base}LEVEL: Basic — Day 14. Teach family: അമ്മ(mother), അച്ഛൻ(father), ജ്യേഷ്ഠൻ(elder brother), അനുജൻ(younger brother), ചേച്ചി(elder sister), കുടുംബം(family).`,
    food:`${base}LEVEL: Basic — Day 15. Teach food: ചോറ്(rice), കറി(curry), ചായ(tea), വെള്ളം(water), പഴം(fruit), ഭക്ഷണം(food).`,
    days:`${base}LEVEL: Basic — Day 16. Teach days: തിങ്കൾ(Monday) through ഞായർ(Sunday) with pronunciation.`,
    months:`${base}LEVEL: Basic — Day 17. Teach Malayalam months and seasons: ഇടവം, കർക്കടകം, etc. and seasons: വേനൽ(summer), മഴ(monsoon), ശൈത്യം(winter).`,
    sentences_1:`${base}LEVEL: Basic — Day 19. Teach simple sentences: ഞാൻ [name] ആണ് (I am…), ഇത് [object] ആണ് (This is…). Practice with examples.`,
    questions_1:`${base}LEVEL: Basic — Day 20. Teach questions: എന്ത്(what), ആര്(who), എവിടെ(where), എപ്പോൾ(when), എങ്ങനെ(how). Form simple questions.`,
    directions:`${base}LEVEL: Basic — Day 21. Teach directions: വടക്ക്(north), തെക്ക്(south), കിഴക്ക്(east), പടിഞ്ഞാറ്(west), ഇടത്ത്(left), വലത്ത്(right).`,
    time:`${base}LEVEL: Basic — Day 22. Teach time: സമയം(time), രാവിലെ(morning), ഉച്ചയ്ക്ക്(afternoon), വൈകുന്നേരം(evening), രാത്രി(night).`,
    shopping:`${base}LEVEL: Basic — Day 23. Teach shopping vocabulary: വില(price), വാങ്ങുക(buy), വിൽക്കുക(sell), കടം(debt), കൊടുക്കൂ(please give).`,
    pronouns:`${base}LEVEL: Basic — Day 25. Teach pronouns: ഞാൻ(I), നീ/നിങ്ങൾ(you), അവൻ/അവൾ(he/she), അത്(it), ഞങ്ങൾ(we), അവർ(they).`,
    verbs_basic:`${base}LEVEL: Basic — Day 26. Teach common verbs in infinitive: പോക(go), വരിക(come), ഉണ്ണുക(eat), കുടിക്കുക(drink), ഉറങ്ങുക(sleep), ഓടുക(run).`,
    adjectives:`${base}LEVEL: Basic — Day 27. Teach adjectives: നല്ല(good), ചീത്ത(bad), വലിയ(big), ചെറിയ(small), ചൂട്(hot), തണുപ്പ്(cold).`,
    review_basic:`${base}LEVEL: Basic — Day 28. Comprehensive review: vowels, numbers, greetings, family, common sentences. Fill gaps.`,
    conversation_1:`${base}LEVEL: Basic — Day 29. Practice a complete conversation: introducing yourself, asking basic questions, shopping scenario.`,
    test_final:`${base}LEVEL: Basic — Final Day 30. Comprehensive review of all 30 days. Prepare student for Intermediate level.`,
    // INTERMEDIATE
    present_tense:`${base}LEVEL: Intermediate — Day 1. Teach present tense: verb root + ഉന്നു/കുന്നു. Examples: പോക→പോകുന്നു, കഴിക്കുക→കഴിക്കുന്നു. Practice with common verbs.`,
    past_tense:`${base}LEVEL: Intermediate — Day 2. Teach past tense: verb root + ഇ/ി/ത്തു. Examples: പോക→പോയി, കഴിക്കുക→കഴിച്ചു. Contrast with present tense.`,
    future_tense:`${base}LEVEL: Intermediate — Day 3. Teach future tense: verb root + ഉം. Examples: പോക→പോകും, വരിക→വരും. Also teach ആകും(will be).`,
    negation:`${base}LEVEL: Intermediate — Day 4. Teach negation with ഇല്ല(not/no), ഇല്ലായിരുന്നു(was not), ഇല്ല+future. Also teach question words in sentences.`,
    postpositions:`${base}LEVEL: Intermediate — Day 5. Teach postpositions: ൽ/ിൽ(in), ക്ക്(to/for), ഓട്(with), നിന്ന്(from), ആൽ(by/with). Use with example sentences.`,
    market:`${base}LEVEL: Intermediate — Day 7. Market scenario: bargaining, asking prices, vegetable/fruit names. Key phrases: എത്ര(how much), കൂടുതൽ(too much), കുറഞ്ഞ വിലയ്ക്ക്(cheaper).`,
    travel:`${base}LEVEL: Intermediate — Day 8. Travel vocabulary: ബസ്(bus), ട്രെയിൻ(train), വിമാനം(plane), ടിക്കറ്റ്(ticket), സ്ഥലം(place), യാത്ര(journey).`,
    health:`${base}LEVEL: Intermediate — Day 9. Health vocabulary: ഡോക്ടർ(doctor), ആശുപത്രി(hospital), വേദന(pain), പനി(fever), മരുന്ന്(medicine). Practice describing symptoms.`,
    weather:`${base}LEVEL: Intermediate — Day 10. Weather: മഴ(rain), വെയിൽ(sunshine), കാറ്റ്(wind), മഞ്ഞ്(fog/frost), ചൂട്(heat), തണുപ്പ്(cold). Practice describing Kerala's monsoon.`,
    work:`${base}LEVEL: Intermediate — Day 11. Occupations: ഡോക്ടർ(doctor), അദ്ധ്യാപകൻ(teacher), കർഷകൻ(farmer), ആശ്രയം(engineer), ഗവൺമെന്റ്(government). Work-related phrases.`,
    requests:`${base}LEVEL: Intermediate — Day 13. Polite requests: ദയവായി(please), ആകുമോ(is it possible?), ഒന്ന് സഹായിക്കൂ(please help). Formal vs informal request forms.`,
    opinions:`${base}LEVEL: Intermediate — Day 14. Expressing opinions: എനിക്ക് തോന്നുന്നത്(I think), എന്റെ അഭിപ്രായം(my opinion), ശരിയല്ല(that's not right), തീർച്ചയായും(certainly).`,
    phone:`${base}LEVEL: Intermediate — Day 15. Phone conversations: ഹലോ(hello), ആരാണ്(who is this?), ഒരു നിമിഷം(one moment), കണക്ഷൻ(connection). Email formal phrases.`,
    stories:`${base}LEVEL: Intermediate — Day 16. Storytelling techniques: narrative connectors — അതിനുശേഷം(after that), പിന്നെ(then), കാരണം(because), ഒടുവിൽ(finally).`,
    formal_informal:`${base}LEVEL: Intermediate — Day 17. Formal Malayalam: -ഉ(you formal) vs നീ(you informal). Official language vs colloquial. Professional writing style.`,
    reading_1:`${base}LEVEL: Intermediate — Day 19. Guide student through reading a simple Malayalam paragraph. Identify new words, help comprehension.`,
    writing_1:`${base}LEVEL: Intermediate — Day 20. Teach paragraph writing: topic sentence, supporting details, conclusion. Practice writing about daily routine.`,
    compound:`${base}LEVEL: Intermediate — Day 21. Compound words (Samasam): how two words merge in Malayalam. Examples: ആകാശ+ഗംഗ=ആകാശഗംഗ. Types: Tatpurusha, Dvandva.`,
    idioms:`${base}LEVEL: Intermediate — Day 22. Common idioms: ആനക്കോൽ(elephant stick=backbone), കണ്ണ് തുറക്കുക(open eyes=realize). Teach 5-7 common idioms with context.`,
    proverbs_intro:`${base}LEVEL: Intermediate — Day 23. Introduce 5 famous Malayalam proverbs with meaning and context: e.g. 'കണ്ണിൽ കണ്ടതൊക്കെ...'. Discuss their wisdom.`,
    culture:`${base}LEVEL: Intermediate — Day 25. Kerala culture: Onam, Vishu, Thrissur Pooram, Kathakali, Mohiniattam. Teach cultural vocabulary.`,
    places:`${base}LEVEL: Intermediate — Day 26. Describe Kerala places: backwaters, mountains, beaches. Use descriptive adjectives and place names.`,
    feelings:`${base}LEVEL: Intermediate — Day 27. Expressing feelings: സന്തോഷം(happy), ദുഃഖം(sad), ദേഷ്യം(angry), ഭയം(fear), സ്നേഹം(love). Sentences with feelings.`,
    media:`${base}LEVEL: Intermediate — Day 28. News vocabulary: വാർത്ത(news), ടെലിവിഷൻ(TV), പത്രം(newspaper), ഇന്റർനെറ്റ്(internet), സോഷ്യൽ മീഡിയ(social media).`,
    conversation_2:`${base}LEVEL: Intermediate — Day 29. Full conversation practice: ordering food at restaurant, asking for directions, making an appointment.`,
    // ADVANCED
    complex_sentences:`${base}LEVEL: Advanced — Day 1. Teach complex sentence structures with subordinate clauses. Use relative pronouns, conjunctions, and embedded clauses in Malayalam.`,
    conditionals:`${base}LEVEL: Advanced — Day 2. Conditional clauses: ആണെങ്കിൽ(if it is), ആയിരുന്നെങ്കിൽ(if it were), ആകുമായിരുന്നു(would have been). Real vs unreal conditionals.`,
    passive:`${base}LEVEL: Advanced — Day 3. Passive voice (Karma Vaachyam): converting active to passive. Teach -പ്പെടുന്നു suffix. Compare active/passive usage.`,
    relative:`${base}LEVEL: Advanced — Day 4. Relative clauses: participial forms in Malayalam. How verbs become modifiers. Examples with -(ക്കുന്ന, -ത്ത) forms.`,
    reported:`${base}LEVEL: Advanced — Day 5. Reported speech: direct quote → indirect. Tense backshifting in Malayalam. Use of -എന്ന്(that/saying) connector.`,
    poetry:`${base}LEVEL: Advanced — Day 7. Classical Malayalam poetry: Ramacharitam, Manipravalam. Teach meter (vrittam), poetic devices (alankaaram). Read and analyze a verse.`,
    ramayana:`${base}LEVEL: Advanced — Day 8. Adhyatma Ramayanam by Thunchaththu Ezhuthachan — father of Modern Malayalam. Read passages, analyze language, cultural significance.`,
    literature:`${base}LEVEL: Advanced — Day 9. Modern literature: G. Sankara Kurup (first Jnanpith), Vaikom Muhammad Basheer, O.V. Vijayan. Their style and contributions.`,
    rhetoric:`${base}LEVEL: Advanced — Day 10. Literary devices: ഉപമ(simile), രൂപകം(metaphor), അനുപ്രാസം(alliteration), ആശ്ലേഷം(personification) in Malayalam texts.`,
    proverbs_adv:`${base}LEVEL: Advanced — Day 11. Deep analysis of 8 famous Malayalam proverbs. Explore linguistic structure, philosophical meaning, and cultural context.`,
    letters:`${base}LEVEL: Advanced — Day 13. Formal letter writing: official format, honorifics, closing phrases. Practice: job application letter, official complaint.`,
    business:`${base}LEVEL: Advanced — Day 14. Business Malayalam: meetings, presentations, negotiations. Formal vocabulary for professional settings.`,
    academic:`${base}LEVEL: Advanced — Day 15. Academic writing: thesis statements, argumentation, citation style in Malayalam. Essay structure and academic register.`,
    legal:`${base}LEVEL: Advanced — Day 16. Legal language: court terminology, official documents, government Malayalam. Sanskrit loanwords in legal context.`,
    journalism:`${base}LEVEL: Advanced — Day 17. News writing style: headline writing, inverted pyramid structure, journalistic Malayalam vocabulary.`,
    dialects:`${base}LEVEL: Advanced — Day 19. Malayalam dialects: differences between Thiruvananthapuram, Thrissur, Kozhikode, Kasaragod varieties. Tulu influence, Tamil influence.`,
    sanskrit:`${base}LEVEL: Advanced — Day 20. Sanskrit loanwords (Tatsama/Tadbhava): how Sanskrit words entered Malayalam. Transform Tatsama → Tadbhava forms.`,
    debate:`${base}LEVEL: Advanced — Day 21. Debate & argumentation: logical connectors, counter-arguments, persuasive language. Practice a structured debate in Malayalam.`,
    humour:`${base}LEVEL: Advanced — Day 22. Humour and wordplay: puns, double meanings, satire in Malayalam. Analyse comedy from films/literature.`,
    films:`${base}LEVEL: Advanced — Day 23. Malayalam cinema language: colloquial dialogue, regional accents in films. Discuss films by Adoor Gopalakrishnan, Padmarajan.`,
    translation:`${base}LEVEL: Advanced — Day 25. Translation techniques: Malayalam↔English. Challenges of translating idioms, culture-specific terms. Practice passages.`,
    nuance:`${base}LEVEL: Advanced — Day 26. Nuance and register: choosing the right word, formal/informal/poetic registers. Connotation vs denotation in Malayalam.`,
    story_writing:`${base}LEVEL: Advanced — Day 27. Creative writing: short story structure, character development, descriptive writing in Malayalam. Write a 100-word story.`,
    speaking:`${base}LEVEL: Advanced — Day 28. Public speaking: speech structure, rhetorical techniques, delivery. Practice a 2-minute speech in Malayalam.`,
    realworld:`${base}LEVEL: Advanced — Day 29. Real-world conversation: job interview, academic discussion, cultural event. Full immersive practice session.`,
    test:`${base}Conduct a comprehensive test for this week's topics. Ask 5-8 varied questions covering vocabulary, grammar, and usage. Give detailed feedback.`,
    test_final:`${base}This is the FINAL exam for this level. Comprehensive assessment covering all topics. After completion, advise on readiness to advance to next level.`,
  };
  return topics[topic]||topics['vowels'];
}

// ══ VOWELS DATA ═══════════════════════════════════════════════════════════════
const VOWELS=[
  {ml:"അ",tr:"a",hi:"अ",ex:"അമ്മ (amma - mother)",ipa:"ə",hint:"like 'u' in 'cup'"},
  {ml:"ആ",tr:"aa",hi:"आ",ex:"ആന (aana - elephant)",ipa:"aː",hint:"like 'a' in 'father'"},
  {ml:"ഇ",tr:"i",hi:"इ",ex:"ഇല (ila - leaf)",ipa:"i",hint:"like 'i' in 'bit'"},
  {ml:"ഈ",tr:"ii",hi:"ई",ex:"ഈച്ച (iicha - fly)",ipa:"iː",hint:"like 'ee' in 'see'"},
  {ml:"ഉ",tr:"u",hi:"उ",ex:"ഉപ്പ് (uppu - salt)",ipa:"u",hint:"like 'u' in 'put'"},
  {ml:"ഊ",tr:"uu",hi:"ऊ",ex:"ഊഞ്ഞാൽ (uunjaal - swing)",ipa:"uː",hint:"like 'oo' in 'food'"},
  {ml:"എ",tr:"e",hi:"ए",ex:"എലി (eli - rat)",ipa:"e",hint:"like 'e' in 'bed'"},
  {ml:"ഏ",tr:"ee",hi:"ए",ex:"ഏണി (eeni - ladder)",ipa:"eː",hint:"like 'a' in 'take'"},
  {ml:"ഐ",tr:"ai",hi:"ऐ",ex:"ഐശ്വര്യം (wealth)",ipa:"ai",hint:"like 'i' in 'kite'"},
  {ml:"ഒ",tr:"o",hi:"ओ",ex:"ഒട്ടകം (ottakam - camel)",ipa:"o",hint:"like 'o' in 'pot'"},
  {ml:"ഓ",tr:"oo",hi:"ओ",ex:"ഓട്ടം (oottam - running)",ipa:"oː",hint:"like 'o' in 'note'"},
  {ml:"ഔ",tr:"au",hi:"औ",ex:"ഔഷധം (medicine)",ipa:"au",hint:"like 'ou' in 'loud'"},
  {ml:"അം",tr:"am",hi:"अं",ex:"സംഗീതം (music)",ipa:"əm",hint:"nasal 'm' ending"},
];

// ══ SPEECH ENGINE — Kerala Female Voice ══════════════════════════════════════

// Malayalam → spoken phonetic English (what the TTS actually says aloud)
const ML_PHONETIC={
  "അ":"a","ആ":"aa","ഇ":"i","ഈ":"ee","ഉ":"u","ഊ":"oo",
  "എ":"e","ഏ":"ay","ഐ":"ai","ഒ":"o","ഓ":"oh","ഔ":"ow","അം":"um"
};

// Malayalam consonants/full chars → romanised (for unknown chars)
const ML_TR={
  "അ":"a","ആ":"aa","ഇ":"i","ഈ":"ii","ഉ":"u","ഊ":"uu","എ":"e","ഏ":"ee",
  "ഐ":"ai","ഒ":"o","ഓ":"oo","ഔ":"au","അം":"am",
  "ക":"ka","ഖ":"kha","ഗ":"ga","ഘ":"gha","ങ":"nga",
  "ച":"cha","ഛ":"chha","ജ":"ja","ഝ":"jha","ഞ":"nya",
  "ട":"ta","ഠ":"tha","ഡ":"da","ഢ":"dha","ണ":"na",
  "ത":"tha","ഥ":"thha","ദ":"da","ധ":"dha","ന":"na",
  "പ":"pa","ഫ":"pha","ബ":"ba","ഭ":"bha","മ":"ma",
  "യ":"ya","ര":"ra","ല":"la","വ":"va","ശ":"sha","ഷ":"sha",
  "സ":"sa","ഹ":"ha","ള":"la","ഴ":"zha","റ":"ra",
  "്":"","ാ":"aa","ി":"i","ീ":"ee","ു":"u","ൂ":"oo",
  "െ":"e","േ":"ay","ൈ":"ai","ൊ":"o","ോ":"oh","ൌ":"ow","ൗ":"ow","ം":"m","ഃ":"ha"
};

// Hindi Devanagari → spoken English phonetics
const HI_PHONETIC={
  "अ":"a","आ":"aa","इ":"i","ई":"ee","उ":"u","ऊ":"oo",
  "ए":"ay","ऐ":"ai","ओ":"oh","औ":"ow",
  "क":"ka","ख":"kha","ग":"ga","घ":"gha","ङ":"nga",
  "च":"cha","छ":"chha","ज":"ja","झ":"jha","ञ":"nya",
  "ट":"ta","ठ":"tha","ड":"da","ढ":"dha","ण":"na",
  "त":"tha","थ":"thha","द":"da","ध":"dha","न":"na",
  "प":"pa","फ":"pha","ब":"ba","भ":"bha","म":"ma",
  "य":"ya","र":"ra","ल":"la","व":"va","श":"sha","ष":"sha",
  "स":"sa","ह":"ha","क्ष":"ksha","त्र":"tra","ज्ञ":"gya",
  "ा":"aa","ि":"i","ी":"ee","ु":"u","ू":"oo","े":"ay","ै":"ai",
  "ो":"oh","ौ":"ow","ं":"n","ः":"ha","्":""
};

// ── Voice cache ───────────────────────────────────────────────────────────────
let _vx=[];
let _voicesReady=false;
let _voiceReadyCbs=[];

function _loadVoices(){
  if(!window.speechSynthesis)return;
  const v=window.speechSynthesis.getVoices();
  if(v.length){_vx=v;_voicesReady=true;_voiceReadyCbs.forEach(f=>f());_voiceReadyCbs=[];}
}
if(window.speechSynthesis){
  window.speechSynthesis.onvoiceschanged=()=>{_loadVoices();};
  _loadVoices();
}
function onVoicesReady(cb){
  if(_voicesReady){cb();return;}
  _voiceReadyCbs.push(cb);
  setTimeout(()=>{
    if(!_voicesReady){
      _loadVoices();
      if(!_voicesReady){_voicesReady=true;_voiceReadyCbs.forEach(f=>f());_voiceReadyCbs=[];}
    }
  },1200);
}

// ── Kerala female voice selector ─────────────────────────────────────────────
function gv(){
  if(!_vx.length)_vx=window.speechSynthesis?.getVoices()||[];
  const n=s=>s.toLowerCase().replace(/[_\-]/g," ");
  const indFem=["veena","raveena","heera","priya","neerja","lekha","aditi","divya","meera","female"];
  const westFem=["zira","susan","karen","samantha","victoria","moira","tessa","fiona","ava","allison","joanna","salli","kimberly"];
  const isIF=v=>indFem.some(k=>n(v.name).includes(k));
  const isWF=v=>westFem.some(k=>n(v.name).includes(k));
  const lm=(v,p)=>v.lang.replace("_","-").startsWith(p);
  return(
    _vx.find(v=>lm(v,"en-IN")&&isIF(v))||
    _vx.find(v=>lm(v,"en-IN"))||
    _vx.find(v=>lm(v,"en-GB")&&isWF(v))||
    _vx.find(v=>lm(v,"en-GB"))||
    _vx.find(v=>lm(v,"en-AU")&&isWF(v))||
    _vx.find(v=>lm(v,"en-US")&&isWF(v))||
    _vx.find(v=>lm(v,"en"))||_vx[0]||null
  );
}

function trML(t){
  let r=t;
  Object.entries(ML_TR).forEach(([m,e])=>{r=r.split(m).join(e);});
  return r;
}

// ── Translate Hindi Devanagari in a string to phonetic English ────────────────
function translateHindi(text){
  // Replace multi-char sequences first, then single chars
  let t=text;
  // Multi-char (conjuncts)
  Object.entries(HI_PHONETIC).filter(([k])=>k.length>1).forEach(([k,v])=>{
    t=t.split(k).join(" "+v+" ");
  });
  // Single chars
  Object.entries(HI_PHONETIC).filter(([k])=>k.length===1).forEach(([k,v])=>{
    t=t.split(k).join(v);
  });
  return t;
}

// ── Master text cleaner — removes ALL symbols, speaks Hindi, transliterates Malayalam ──
function cleanForSpeech(raw){
  if(!raw)return"";
  let t=raw;

  // 1. Replace known Malayalam vowels with their spoken phonetic form
  Object.entries(ML_PHONETIC).forEach(([m,p])=>{
    t=t.split(m).join(` ${p} `);
  });

  // 2. Transliterate remaining Malayalam script characters
  t=t.replace(/[\u0D00-\u0D7F]/g,c=>ML_TR[c]||"");

  // 3. Translate Hindi Devanagari to spoken English phonetics
  t=translateHindi(t);

  // 4. Strip ALL markdown formatting
  t=t.replace(/\*\*(.+?)\*\*/gs,"$1")   // bold
     .replace(/\*(.+?)\*/gs,"$1")        // italic
     .replace(/#{1,6}\s*/g,"")           // headers
     .replace(/`{1,3}[^`]*`{1,3}/g," ") // code
     .replace(/\[([^\]]+)\]\([^)]+\)/g,"$1") // links
     .replace(/!\[[^\]]*\]\([^)]+\)/g," ")   // images
     .replace(/\|[^\n]*/g," ")           // table cells
     .replace(/^>\s*/gm," ");            // blockquotes

  // 5. Strip ALL punctuation symbols that TTS reads literally
  // Dashes, hyphens, underscores → short pause (comma)
  t=t.replace(/\s*[-–—]\s*/g,", ");
  // Slashes → " or "
  t=t.replace(/\s*\/\s*/g," or ");
  // Pipes → space
  t=t.replace(/\|/g," ");
  // Parentheses and brackets → spoken content only, strip the brackets
  t=t.replace(/[(){}\[\]]/g," ");
  // Colons and semicolons → pause
  t=t.replace(/[;:]/g,",");
  // Ellipsis → pause
  t=t.replace(/\.{2,}/g,". ");
  // Arrows
  t=t.replace(/→|→|=>|->|←|<-/g," becomes ");
  // Plus signs between words
  t=t.replace(/\s*\+\s*/g," plus ");
  // Equals signs
  t=t.replace(/\s*=\s*/g," equals ");
  // Percent
  t=t.replace(/(\d)\s*%/g,"$1 percent");
  // Hash/number
  t=t.replace(/#(\d)/g,"number $1").replace(/#/g," ");
  // Asterisks leftover
  t=t.replace(/\*/g," ");
  // Underscores
  t=t.replace(/_/g," ");
  // Backticks
  t=t.replace(/`/g," ");
  // Quotes (don't read quote marks aloud)
  t=t.replace(/["""''`]/g," ");
  // IPA slashes /xyz/
  t=t.replace(/\/[a-zːəɪʊæɛɔ]{1,6}\//gi," ");

  // 6. Strip emojis
  t=t.replace(/[\u{1F000}-\u{1FFFF}]/gu," ")
     .replace(/[\u{2600}-\u{27BF}]/gu," ")
     .replace(/[\uFE00-\uFE0F\u200D\u200B]/g,"");

  // 7. Strip any remaining non-ASCII (covers Devanagari missed, other scripts)
  t=t.replace(/[^\x20-\x7E\n]/g," ");

  // 8. Clean up bullet list markers
  t=t.replace(/^\s*[-*•·]\s+/gm," ");

  // 9. Normalize whitespace and newlines
  t=t.replace(/[ \t]{2,}/g," ").replace(/\n+/g,". ").trim();

  // 10. Kerala accent prosody tweaks
  t=t.replace(/\bthe\b/g,"dhe");
  t=t.replace(/\bis pronounced\b/g,"is pronounced,");
  t=t.replace(/\bmeans\b/g,", means");

  // 11. Remove any double commas or comma-period artifacts
  t=t.replace(/,\s*,/g,",").replace(/,\s*\./g,".").replace(/\.\s*\./g,".");

  return t.trim();
}

// ── Chunk text into ≤200-char pieces at sentence boundaries ──────────────────
function chunkText(text,maxLen=200){
  const chunks=[];
  const sentences=text.split(/(?<=[.!?])\s+/);
  let cur="";
  for(const s of sentences){
    if(!s.trim())continue;
    if((cur+s).length>maxLen&&cur){chunks.push(cur.trim());cur=s;}
    else{cur=(cur?cur+" ":"")+s;}
  }
  if(cur.trim())chunks.push(cur.trim());
  return chunks.filter(c=>c.length>2);
}

// ── Core speech queue ─────────────────────────────────────────────────────────
// NOTE: speechSynthesis.pause()/resume() is broken in Chrome, Android WebView,
// and many other browsers — it silently drops the utterance or never resumes.
// We implement software pause: cancel the current utterance, save remaining
// queue + elapsed position estimate; on resume re-speak from saved chunks.

const KERALA_RATE=0.82;
const KERALA_PITCH=1.18;

let _speaking=false;
let _paused=false;
let _queue=[];           // pending {text,rate,pitch} chunks
let _pausedQueue=[];     // saved queue when paused (including current chunk)
let _currentChunk=null;  // the chunk currently being spoken
let _currentStartMs=0;   // when current chunk started (for position estimate)
let _currentRate=KERALA_RATE;

function _makeUtterance(text,rate,pitch){
  const u=new SpeechSynthesisUtterance(text);
  u.volume=1;
  u.rate=rate||KERALA_RATE;
  u.pitch=pitch||KERALA_PITCH;
  u.lang="en-IN";
  const v=gv();if(v)u.voice=v;
  return u;
}

function _flushQueue(){
  if(_speaking||_paused||!_queue.length)return;
  if(!window.speechSynthesis)return;
  const item=_queue.shift();
  _currentChunk=item;
  _currentStartMs=Date.now();
  _currentRate=item.rate||KERALA_RATE;
  _speaking=true;
  const u=_makeUtterance(item.text,item.rate,item.pitch);
  u.onend=()=>{_speaking=false;_currentChunk=null;_flushQueue();};
  u.onerror=()=>{_speaking=false;_currentChunk=null;_flushQueue();};
  try{window.speechSynthesis.speak(u);}catch(e){_speaking=false;_flushQueue();}
}

function _enqueue(text,rate,pitch){
  _queue.push({text,rate,pitch});
  _flushQueue();
}

// ── Public API ────────────────────────────────────────────────────────────────
function doSpeak(text,rate=KERALA_RATE,pitch=KERALA_PITCH){
  if(!window.speechSynthesis||!text?.trim())return;
  // Cancel everything, reset state
  window.speechSynthesis.cancel();
  _queue=[];_pausedQueue=[];_speaking=false;_paused=false;_currentChunk=null;
  const cleaned=cleanForSpeech(text);
  if(!cleaned.trim())return;
  const chunks=chunkText(cleaned,220);
  onVoicesReady(()=>{chunks.forEach(c=>_enqueue(c,rate,pitch));});
}

function pauseSpeech(){
  if(_paused)return;
  // Estimate how far through the current chunk we are (by time × chars/sec)
  // Then rebuild queue: remainder of current chunk + remaining chunks
  const saved=[];
  if(_currentChunk){
    const elapsed=(Date.now()-_currentStartMs)/1000; // seconds
    const charsSpoken=Math.floor(elapsed*_currentRate*14); // ~14 chars/sec at rate=1
    const remaining=_currentChunk.text.slice(charsSpoken).trim();
    if(remaining.length>3)saved.push({..._currentChunk,text:remaining});
  }
  // Add all remaining queued chunks
  _pausedQueue=[...saved,..._queue];
  _queue=[];
  window.speechSynthesis.cancel();
  _speaking=false;_currentChunk=null;
  _paused=true;
}

function resumeSpeech(){
  if(!_paused)return;
  _paused=false;
  // Re-enqueue saved chunks
  const toSpeak=[..._pausedQueue];
  _pausedQueue=[];
  onVoicesReady(()=>{toSpeak.forEach(c=>_enqueue(c.text,c.rate,c.pitch));});
}

function stopSpeech(){
  window.speechSynthesis?.cancel();
  _queue=[];_pausedQueue=[];_speaking=false;_paused=false;_currentChunk=null;
}

function isSpeechPaused(){return _paused;}
function isSpeaking(){return _speaking||_queue.length>0;}

// Vowel: slow & clear, spell out full phonetics with Hindi
function speakVowel(v){
  const text=`The Malayalam letter ${v.tr}. In Hindi it is ${v.hi}. It sounds like ${ML_PHONETIC[v.ml]||v.tr}. Example word: ${v.ex.replace(/[\u0D00-\u0D7F]+/g,"")}`;
  doSpeak(text,0.74,KERALA_PITCH);
}

function speakMsg(text){if(text?.trim())doSpeak(text,KERALA_RATE,KERALA_PITCH);}

function unlockAudio(){
  if(!window.speechSynthesis)return;
  window.speechSynthesis.cancel();
  _speaking=false;_queue=[];_pausedQueue=[];_paused=false;_currentChunk=null;
  const u=new SpeechSynthesisUtterance(".");
  u.volume=1;u.rate=2;u.lang="en-IN";
  const v=gv();if(v)u.voice=v;
  u.onend=()=>{_speaking=false;};
  u.onerror=()=>{_speaking=false;};
  onVoicesReady(()=>{try{window.speechSynthesis.speak(u);}catch(e){}});
}

const SCREEN={LOGIN:"login",REGISTER:"register",FORGOT:"forgot",DASHBOARD:"dashboard",TUTOR:"tutor"};

// ══ ROOT ══════════════════════════════════════════════════════════════════════
export default function App(){
  const [screen,setScreen]=useState(null); // null = loading
  const [user,setUser]=useState(null);
  const [progress,setProgress]=useState({});
  const [selectedLevel,setSelectedLevel]=useState("basic");
  const [selectedDay,setSelectedDay]=useState(1);
  const progressRef=useRef({});

  // On mount: try to restore session from localStorage
  useEffect(()=>{
    dbRestoreSession().then(res=>{
      if(res?.user){
        setUser(res.user);
        const p={...EMPTY_PROGRESS,...res.progress};
        setProgress(p);progressRef.current=p;
        setScreen(SCREEN.DASHBOARD);
      } else {
        setScreen(SCREEN.LOGIN);
      }
    }).catch(()=>setScreen(SCREEN.LOGIN));
  },[]);

  async function login(cred,pw){
    // Demo account — no DB needed
    if((cred.toLowerCase().trim()==="demo@aksharadhara.in"||cred.toLowerCase().trim()==="demo_student")&&pw==="demo1234"){
      setUser(DEMO_USER);
      const p={...DEMO_PROGRESS};
      setProgress(p);progressRef.current=p;
      setScreen(SCREEN.DASHBOARD);
      return null;
    }
    const res=await dbLogin(cred,pw);
    if(res.error)return res.error;
    setUser(res.user);
    const p={...EMPTY_PROGRESS,...res.progress};
    setProgress(p);progressRef.current=p;
    setScreen(SCREEN.DASHBOARD);
    return null;
  }

  async function register(email,name,username,pw){
    if(!/^[a-z0-9_]{3,20}$/.test(username))return"Username: 3-20 chars, a-z 0-9 _ only.";
    const res=await dbRegister(email,name,username,pw);
    if(res.error)return res.error;
    return login(email,pw);
  }

  async function logout(){
    stopSpeech();
    await dbLogout(user?.id);
    setUser(null);setProgress({});progressRef.current={};
    setScreen(SCREEN.LOGIN);
  }

  function goTutor(level,day){
    setSelectedLevel(level);setSelectedDay(day);
    const np={...progressRef.current,sessions:(progressRef.current.sessions||0)+1};
    setProgress(np);progressRef.current=np;
    if(user?.id&&!user?.isDemo)dbSaveProgress(user.id,np);
    setScreen(SCREEN.TUTOR);
  }

  function updateProgress(patch){
    const np={...progressRef.current,...patch};
    setProgress(np);progressRef.current=np;
    if(user?.id&&!user?.isDemo)dbSaveProgress(user.id,np);
  }

  // Loading splash
  if(!screen)return(
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#140c00,#2a1500)",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{fontFamily:"'Noto Sans Malayalam',sans-serif",fontSize:56,color:"#e8a820",animation:"pulse 1.2s infinite"}}>അ</div>
      <div style={{fontFamily:"Georgia,serif",fontSize:20,color:"#e8a820"}}>Aksharadhara</div>
      <div style={{fontSize:13,color:"rgba(200,134,10,.5)"}}>Loading…</div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
    </div>
  );

  if(screen===SCREEN.LOGIN)     return <LoginScreen onLogin={login} onSwitch={()=>setScreen(SCREEN.REGISTER)} onForgot={()=>setScreen(SCREEN.FORGOT)}/>;
  if(screen===SCREEN.REGISTER)  return <RegisterScreen onRegister={register} onSwitch={()=>setScreen(SCREEN.LOGIN)}/>;
  if(screen===SCREEN.FORGOT)    return <ForgotScreen onBack={()=>setScreen(SCREEN.LOGIN)}/>;
  if(screen===SCREEN.DASHBOARD) return <Dashboard user={user} progress={progress} onLogout={logout} onStart={goTutor}/>;
  if(screen===SCREEN.TUTOR)     return <TutorApp user={user} progress={progress} updateProgress={updateProgress} level={selectedLevel} day={selectedDay} onDashboard={()=>setScreen(SCREEN.DASHBOARD)}/>;
  return null;
}

// ══ LOGO ══════════════════════════════════════════════════════════════════════
function Logo({size=1}){
  return(
    <div style={{display:"flex",alignItems:"center",gap:8}}>
      <div style={{width:34*size,height:34*size,borderRadius:9,background:"linear-gradient(135deg,#e8a820,#c8860a)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18*size,color:"#fff",boxShadow:"0 0 14px rgba(200,134,10,.4)",fontFamily:"'Noto Sans Malayalam',sans-serif"}}>അ</div>
      <div>
        <div style={{fontFamily:"Georgia,serif",fontSize:16*size,fontWeight:700,color:"#e8a820"}}>Aksharadhara</div>
        <div style={{fontSize:8*size,color:"rgba(200,134,10,.5)",letterSpacing:2,textTransform:"uppercase"}}>Malayalam AI Tutor</div>
      </div>
    </div>
  );
}
function AuthShell({children}){
  return(
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#140c00 0%,#2a1500 50%,#140c00 100%)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,position:"relative",overflow:"hidden"}}>
      {["അ","ആ","ഇ","ഈ","ഉ","ഊ","എ","ഏ"].map((l,i)=>(
        <div key={l} style={{position:"absolute",fontFamily:"'Noto Sans Malayalam',sans-serif",fontSize:60+i*15,color:"rgba(200,134,10,.04)",userSelect:"none",top:`${10+i*11}%`,left:`${i%2===0?5:75}%`,transform:`rotate(${i*7-20}deg)`}}>{l}</div>
      ))}
      {children}
    </div>
  );
}
const SL={authCard:{background:"#fdf6e9",border:"1px solid rgba(160,120,64,.3)",borderRadius:20,padding:"32px 30px",width:"100%",maxWidth:420,boxShadow:"0 20px 80px rgba(0,0,0,.4)",position:"relative",zIndex:1,animation:"fadeIn .3s ease"},label:{display:"block",fontSize:12,fontWeight:700,color:"#6b4f2a",marginBottom:5,marginTop:14,textTransform:"uppercase",letterSpacing:.5},inp:{width:"100%",padding:"11px 14px",borderRadius:10,border:"1.5px solid rgba(160,120,64,.3)",background:"#fff",fontSize:14,color:"#2c1a06",fontFamily:"inherit",outline:"none",boxSizing:"border-box",marginBottom:2},btn:{width:"100%",padding:13,background:"linear-gradient(135deg,#e8a820,#c8860a)",border:"none",borderRadius:12,color:"#fff",fontWeight:800,fontSize:15,cursor:"pointer",boxShadow:"0 4px 18px rgba(200,134,10,.4)"},err:{background:"rgba(176,48,32,.08)",border:"1px solid rgba(176,48,32,.25)",borderRadius:8,padding:"9px 12px",fontSize:13,color:"#b03020",marginTop:8},ok:{background:"rgba(30,107,60,.08)",border:"1px solid rgba(30,107,60,.25)",borderRadius:8,padding:"9px 12px",fontSize:13,color:"#1e6b3c",marginTop:8}};

// ══ LOGIN ══════════════════════════════════════════════════════════════════════
function LoginScreen({onLogin,onSwitch,onForgot}){
  const [cred,setCred]=useState("");const [pw,setPw]=useState("");const [err,setErr]=useState("");const [busy,setBusy]=useState(false);const [show,setShow]=useState(false);
  async function submit(){
    setErr("");
    if(!cred||!pw){setErr("Please fill all fields.");return;}
    setBusy(true);
    const e=await onLogin(cred,pw);
    if(e)setErr(e);
    setBusy(false);
  }
  return(<AuthShell><div style={SL.authCard}><Logo/><h2 style={{margin:"0 0 4px",fontSize:22,color:C.text,fontFamily:"Georgia,serif"}}>Welcome back</h2><p style={{margin:"0 0 16px",fontSize:13,color:C.muted}}>Continue your Malayalam journey</p>
    {/* Demo account quick-access */}
    <div style={{background:"linear-gradient(135deg,rgba(200,134,10,.12),rgba(200,134,10,.06))",border:"1.5px solid rgba(200,134,10,.4)",borderRadius:12,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
      <div>
        <div style={{fontSize:12,fontWeight:700,color:C.gold}}>🎓 Try Demo Account</div>
        <div style={{fontSize:11,color:C.muted,marginTop:1}}>All 90 lessons unlocked · No sign-up needed</div>
      </div>
      <button onClick={()=>{setCred("demo@aksharadhara.in");setPw("demo1234");setTimeout(submit,50);}} style={{background:"linear-gradient(135deg,#e8a820,#c8860a)",border:"none",borderRadius:9,padding:"7px 14px",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>Enter Demo →</button>
    </div>
    <label style={SL.label}>Email or Username</label><input style={SL.inp} type="text" placeholder="you@example.com or username" value={cred} onChange={e=>setCred(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()}/>
    <label style={SL.label}>Password</label><div style={{position:"relative",marginBottom:4}}><input style={{...SL.inp,marginBottom:0,paddingRight:44}} type={show?"text":"password"} placeholder="Enter password" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()}/><button onClick={()=>setShow(s=>!s)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:C.muted,fontSize:16}}>{show?"🙈":"👁"}</button></div>
    <div style={{textAlign:"right",marginBottom:4}}><span onClick={onForgot} style={{fontSize:12,color:C.gold,cursor:"pointer",fontWeight:600}}>Forgot password?</span></div>
    {err&&<div style={SL.err}>{err}</div>}
    <button style={{...SL.btn,marginTop:12,opacity:busy?.6:1}} onClick={submit} disabled={busy}>{busy?"Signing in…":"Sign In →"}</button>
    <p style={{textAlign:"center",marginTop:18,fontSize:13,color:C.muted}}>No account? <span onClick={onSwitch} style={{color:C.gold,fontWeight:700,cursor:"pointer"}}>Register free</span></p>
  </div></AuthShell>);
}

// ══ REGISTER ══════════════════════════════════════════════════════════════════
function RegisterScreen({onRegister,onSwitch}){
  const [f,setF]=useState({name:"",email:"",username:"",pw:"",pw2:""});const [err,setErr]=useState("");const [busy,setBusy]=useState(false);const [sug,setSug]=useState("");
  useEffect(()=>{if(f.name.trim().length>2)setSug(genUN(f.name));},[f.name]);
  const upd=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  async function submit(){
    setErr("");
    const{name,email,username,pw,pw2}=f;
    if(!name||!email||!username||!pw||!pw2){setErr("Please fill all fields.");return;}
    if(pw!==pw2){setErr("Passwords do not match.");return;}
    if(pw.length<6){setErr("Min 6 characters.");return;}
    if(!/^[a-z0-9_]{3,20}$/.test(username)){setErr("Username: 3-20 chars, a-z 0-9 _ only.");return;}
    setBusy(true);
    const e=await onRegister(email,name,username,pw);
    if(e)setErr(e);
    setBusy(false);
  }
  return(<AuthShell><div style={{...SL.authCard,maxWidth:440}}><Logo/><h2 style={{margin:"0 0 4px",fontSize:22,color:C.text,fontFamily:"Georgia,serif"}}>Create account</h2><p style={{margin:"0 0 16px",fontSize:13,color:C.muted}}>Start your Malayalam learning journey</p>
    {[["Full Name","text","name","Your name"],["Email","email","email","you@example.com"],["Password","password","pw","Min. 6 characters"],["Confirm Password","password","pw2","Repeat password"]].map(([l,t,k,ph])=>(
      <div key={k}><label style={SL.label}>{l}</label><input style={SL.inp} type={t} placeholder={ph} value={f[k]} onChange={upd(k)} onKeyDown={e=>e.key==="Enter"&&submit()}/></div>
    ))}
    <label style={SL.label}>Username <span style={{fontWeight:400,color:C.muted,textTransform:"none"}}>(unique, used to login)</span></label>
    <input style={SL.inp} type="text" placeholder="e.g. arjun_nair" value={f.username} onChange={e=>setF(p=>({...p,username:e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,"")}))} onKeyDown={e=>e.key==="Enter"&&submit()}/>
    {sug&&!f.username&&<div style={{fontSize:11,color:C.teal,cursor:"pointer",marginBottom:6}} onClick={()=>setF(p=>({...p,username:sug}))}>💡 Suggestion: <strong>{sug}</strong> (click to use)</div>}
    {err&&<div style={SL.err}>{err}</div>}
    <button style={{...SL.btn,marginTop:16,opacity:busy?.6:1}} onClick={submit} disabled={busy}>{busy?"Creating account…":"Create Account →"}</button>
    <p style={{textAlign:"center",marginTop:14,fontSize:13,color:C.muted}}>Already registered? <span onClick={onSwitch} style={{color:C.gold,fontWeight:700,cursor:"pointer"}}>Sign in</span></p>
  </div></AuthShell>);
}

// ══ FORGOT PASSWORD ════════════════════════════════════════════════════════════
function ForgotScreen({onBack}){
  const [step,setStep]=useState(1);
  const [email,setEmail]=useState("");
  const [code,setCode]=useState("");
  const [shownCode,setShownCode]=useState("");
  const [pw,setPw]=useState("");const [pw2,setPw2]=useState("");
  const [err,setErr]=useState("");const [msg,setMsg]=useState("");const [busy,setBusy]=useState(false);

  async function sendCode(){
    setErr("");setMsg("");
    if(!email.trim()){setErr("Enter your email address.");return;}
    setBusy(true);
    const res=await dbSendPasswordReset(email.trim());
    setBusy(false);
    if(res.error){setErr(res.error);return;}
    setShownCode(res.code);
    setMsg("✅ Reset code generated! Copy the code below:");
    setStep(2);
  }

  async function doReset(){
    setErr("");
    if(!code.trim()){setErr("Enter the reset code.");return;}
    if(!pw||!pw2){setErr("Enter and confirm your new password.");return;}
    if(pw!==pw2){setErr("Passwords do not match.");return;}
    if(pw.length<6){setErr("Min 6 characters.");return;}
    setBusy(true);
    const res=await dbResetPassword(email.trim(),code.trim(),pw);
    setBusy(false);
    if(res.error){setErr(res.error);return;}
    setMsg("🎉 Password updated! You can now sign in.");
    setTimeout(onBack,2000);
  }

  return(<AuthShell><div style={SL.authCard}><Logo/><h2 style={{margin:"0 0 4px",fontSize:22,color:C.text,fontFamily:"Georgia,serif"}}>Reset Password</h2>
    <div style={{display:"flex",gap:6,margin:"14px 0 18px",alignItems:"center"}}>
      {[1,2].map(s=>(
        <div key={s} style={{display:"flex",alignItems:"center",gap:6}}>
          <div style={{width:26,height:26,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,background:step>=s?"linear-gradient(135deg,#e8a820,#c8860a)":"rgba(160,120,64,.15)",color:step>=s?"#fff":C.muted}}>{step>s?"✓":s}</div>
          {s<2&&<div style={{height:2,width:20,background:step>s?"#e8a820":"rgba(160,120,64,.2)",borderRadius:1}}/>}
        </div>
      ))}
    </div>
    {step===1&&<>
      <label style={SL.label}>Email Address</label>
      <input style={SL.inp} type="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendCode()}/>
      {err&&<div style={SL.err}>{err}</div>}
      <button style={{...SL.btn,marginTop:14,opacity:busy?.6:1}} onClick={sendCode} disabled={busy}>{busy?"Generating…":"Get Reset Code →"}</button>
    </>}
    {step===2&&<>
      {msg&&<div style={SL.ok}>{msg}</div>}
      {shownCode&&<div style={{background:"#1a1200",border:"2px solid #e8a820",borderRadius:10,padding:"12px 16px",textAlign:"center",margin:"10px 0",fontFamily:"monospace",fontSize:28,fontWeight:800,color:"#e8a820",letterSpacing:6}}>{shownCode}</div>}
      <label style={SL.label}>Enter Code</label>
      <input style={{...SL.inp,fontSize:20,letterSpacing:6,textAlign:"center",fontWeight:700}} type="text" maxLength={6} placeholder="000000" value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,""))}/>
      <label style={SL.label}>New Password</label>
      <input style={SL.inp} type="password" placeholder="Min. 6 characters" value={pw} onChange={e=>setPw(e.target.value)}/>
      <label style={SL.label}>Confirm Password</label>
      <input style={SL.inp} type="password" placeholder="Repeat" value={pw2} onChange={e=>setPw2(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doReset()}/>
      {err&&<div style={SL.err}>{err}</div>}
      <button style={{...SL.btn,marginTop:14,opacity:busy?.6:1}} onClick={doReset} disabled={busy}>{busy?"Saving…":"Set New Password ✓"}</button>
    </>}
    <p style={{textAlign:"center",marginTop:14,fontSize:13,color:C.muted}}><span onClick={onBack} style={{color:C.gold,fontWeight:700,cursor:"pointer"}}>← Back to Sign In</span></p>
  </div></AuthShell>);
}

// ══ DASHBOARD ═════════════════════════════════════════════════════════════════
function Dashboard({user,progress,onLogout,onStart}){
  const [activeTab,setActiveTab]=useState("basic");
  const p=progress;
  const isDemo=user?.isDemo;
  const dc=p.daysCompleted||{basic:0,intermediate:0,advanced:0};
  // Demo account: all levels & days fully unlocked
  const canIntermediate=isDemo||dc.basic>=20;
  const canAdvanced=isDemo||dc.intermediate>=20;

  const stats=[
    {icon:"⭐",label:"Total XP",value:p.xp||0,color:"#e8a820"},
    {icon:"🔥",label:"Day Streak",value:`${p.streak||1}d`,color:"#ff8c42"},
    {icon:"📖",label:"Words",value:p.words||0,color:C.teal},
    {icon:"⏱",label:"Minutes",value:p.minutesSpent||0,color:C.green},
    {icon:"📝",label:"Sessions",value:p.sessions||0,color:"#9b59b6"},
    {icon:"🎯",label:"Best Test",value:p.testScores?.length?Math.max(...p.testScores)+"%":"—",color:C.red},
  ];

  const levels=["basic","intermediate","advanced"];

  return(
    <div style={{minHeight:"100vh",background:"#fdf6e9",fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      {/* Topbar */}
      <div style={{height:60,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 28px",background:"linear-gradient(90deg,#140c00,#2a1500,#140c00)",borderBottom:`2px solid ${C.gold}`,boxShadow:"0 3px 20px rgba(0,0,0,.4)"}}>
        <Logo/>
        <div style={{display:"flex",alignItems:"center",gap:14}}>
          {isDemo&&<div style={{fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,background:"rgba(200,134,10,.2)",border:"1px solid rgba(200,134,10,.4)",color:C.goldL}}>🎓 DEMO</div>}
          <div style={{fontSize:13,color:"rgba(255,255,255,.6)"}}>Hello, <strong style={{color:C.goldL}}>{user.name.split(" ")[0]}</strong> <span style={{fontSize:11,color:"rgba(200,134,10,.6)"}}>@{user.username}</span></div>
          <div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,#1a4a2e,#0e3020)",border:`2px solid ${C.gold}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>{user.avatar}</div>
          <button onClick={onLogout} style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.15)",color:"rgba(255,255,255,.6)",padding:"6px 14px",borderRadius:8,cursor:"pointer",fontSize:12}}>Sign out</button>
        </div>
      </div>

      <div style={{maxWidth:1200,margin:"0 auto",padding:"24px 20px"}}>
        {/* Stats */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:10,marginBottom:20}}>
          {stats.map(s=>(
            <div key={s.label} style={{background:C.card,borderRadius:12,padding:"14px 10px",textAlign:"center",border:`1px solid ${C.border}`,boxShadow:"0 2px 8px rgba(60,30,0,.06)"}}>
              <div style={{fontSize:20,marginBottom:3}}>{s.icon}</div>
              <div style={{fontSize:18,fontWeight:800,color:s.color}}>{s.value}</div>
              <div style={{fontSize:9,color:C.muted,textTransform:"uppercase",letterSpacing:.5,marginTop:2}}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Level tabs */}
        <div style={{display:"flex",gap:10,marginBottom:20}}>
          {levels.map(lv=>{
            const m=LEVEL_META[lv];const locked=(lv==="intermediate"&&!canIntermediate)||(lv==="advanced"&&!canAdvanced);
            return(
              <button key={lv} onClick={()=>!locked&&setActiveTab(lv)} style={{flex:1,padding:"14px 16px",borderRadius:14,border:`2px solid ${activeTab===lv?m.color:"rgba(160,120,64,.2)"}`,background:activeTab===lv?m.bg:C.card,cursor:locked?"not-allowed":"pointer",opacity:locked?.5:1,transition:"all .2s",textAlign:"left"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                  <span style={{fontSize:20}}>{m.icon}</span>
                  <span style={{fontSize:15,fontWeight:700,color:activeTab===lv?m.color:C.text}}>{m.label}</span>
                  {locked&&<span style={{fontSize:10,background:"rgba(160,120,64,.15)",color:C.muted,padding:"2px 8px",borderRadius:10,marginLeft:"auto"}}>🔒 Locked</span>}
                  {!locked&&<span style={{fontSize:10,background:m.bg,color:m.color,padding:"2px 8px",borderRadius:10,marginLeft:"auto",fontWeight:700}}>{dc[lv]||0}/30 days</span>}
                </div>
                <div style={{fontSize:11,color:C.muted}}>{m.desc}</div>
                {lv==="intermediate"&&!canIntermediate&&<div style={{fontSize:10,color:C.red,marginTop:4}}>Complete 20+ Basic days to unlock</div>}
                {lv==="advanced"&&!canAdvanced&&<div style={{fontSize:10,color:C.red,marginTop:4}}>Complete 20+ Intermediate days to unlock</div>}
              </button>
            );
          })}
        </div>

        {/* Curriculum for active level */}
        <div style={{background:C.card,borderRadius:16,padding:20,border:`1px solid ${C.border}`,marginBottom:20}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
            <div>
              <div style={{fontFamily:"Georgia,serif",fontSize:18,fontWeight:700,color:C.text}}>{LEVEL_META[activeTab].icon} {LEVEL_META[activeTab].label} Level — 30 Days</div>
              <div style={{fontSize:12,color:C.muted,marginTop:2}}>{LEVEL_META[activeTab].desc}</div>
            </div>
            <div style={{fontSize:13,color:C.muted}}>Progress: <strong style={{color:LEVEL_META[activeTab].color}}>{dc[activeTab]||0}/30</strong></div>
          </div>
          {/* Progress bar */}
          <div style={{height:6,background:"rgba(160,120,64,.12)",borderRadius:3,marginBottom:16}}>
            <div style={{height:"100%",background:`linear-gradient(90deg,${LEVEL_META[activeTab].color},${LEVEL_META[activeTab].light})`,borderRadius:3,width:`${((dc[activeTab]||0)/30)*100}%`,transition:"width .8s ease"}}/>
          </div>
          {/* Week groups */}
          {[1,2,3,4,5].map(wk=>{
            const wDays=CURRICULUM[activeTab].filter(d=>d.week===wk);
            return(
              <div key={wk} style={{marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Week {wk}</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:6}}>
                  {wDays.map(day=>{
                    const done=isDemo||(dc[activeTab]||0)>=day.d;
                    const active=!isDemo&&((dc[activeTab]||0)===day.d-1||(dc[activeTab]||0)===0&&day.d===1);
                    const locked=!isDemo&&((activeTab==="intermediate"&&!canIntermediate)||(activeTab==="advanced"&&!canAdvanced)||(!done&&!active&&day.d>(dc[activeTab]||0)+1));
                    return(
                      <div key={day.d} onClick={()=>!locked&&onStart(activeTab,day.d)} style={{background:done?"rgba(30,107,60,.1)":active?`${LEVEL_META[activeTab].bg}`:"rgba(160,120,64,.06)",border:`1.5px solid ${done?C.green:active?LEVEL_META[activeTab].color:"rgba(160,120,64,.15)"}`,borderRadius:10,padding:"8px 6px",cursor:locked?"not-allowed":"pointer",opacity:locked?.4:1,textAlign:"center",transition:"all .15s"}}>
                        <div style={{fontSize:10,fontWeight:700,color:done?C.green:active?LEVEL_META[activeTab].color:C.muted}}>{day.tst?"🧪":(done?"✓":active?"▶":"📖")}</div>
                        <div style={{fontSize:9,color:done?C.green:active?LEVEL_META[activeTab].color:C.muted,fontWeight:active||done?700:400,marginTop:2}}>D{day.d}</div>
                        <div style={{fontSize:8,color:C.muted,marginTop:1,lineHeight:1.2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{day.t.split(" ").slice(0,2).join(" ")}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Quick start for current level */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
          {[
            {ic:"▶",t:`Start Day ${(dc[activeTab]||0)+1}`,d:`${LEVEL_META[activeTab].label} Level`,bg:LEVEL_META[activeTab].color,click:()=>onStart(activeTab,(dc[activeTab]||0)+1)},
            {ic:"📝",t:"Take Level Test",d:"Test your progress",bg:"#0e6674",click:()=>onStart(activeTab,Math.max(6,(dc[activeTab]||0)))},
            {ic:"📊",t:"View All Levels",d:"Switch & compare",bg:"#7c3aed",click:()=>{}},
          ].map(a=>(
            <div key={a.t} onClick={a.click} style={{background:`linear-gradient(135deg,${a.bg},${a.bg}99)`,borderRadius:14,padding:"16px 18px",cursor:"pointer",boxShadow:"0 4px 14px rgba(0,0,0,.12)",display:"flex",gap:12,alignItems:"center"}}>
              <div style={{fontSize:26}}>{a.ic}</div>
              <div><div style={{fontSize:14,fontWeight:700,color:"#fff"}}>{a.t}</div><div style={{fontSize:11,color:"rgba(255,255,255,.6)",marginTop:2}}>{a.d}</div></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ══ FLASHCARD ════════════════════════════════════════════════════════════════
function FlashcardQuiz({card,onDone,onSkip,onSpeak}){
  const [flipped,setFlipped]=useState(false);const [answered,setAnswered]=useState(null);
  function flip(){setFlipped(f=>!f);if(!flipped&&onSpeak)onSpeak(card.vowel);}
  function answer(i){if(answered!==null)return;setAnswered(i);setTimeout(()=>onDone(i===card.ans),1200);}
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(20,12,0,.88)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:400,padding:20}}>
      <div style={{background:C.bg,borderRadius:24,maxWidth:480,width:"100%",boxShadow:"0 20px 80px rgba(0,0,0,.4)",overflow:"hidden",animation:"slideIn .25s ease"}}>
        <div style={{background:"linear-gradient(135deg,#1a0e00,#2a1800)",padding:"16px 24px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:20}}>🃏</span>
            <div><div style={{fontSize:14,fontWeight:700,color:C.goldL}}>Flashcard Quiz</div><div style={{fontSize:11,color:"rgba(200,134,10,.6)"}}>Today's lesson practice</div></div>
          </div>
          <button onClick={onSkip} style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.15)",color:"rgba(255,255,255,.5)",padding:"5px 12px",borderRadius:8,cursor:"pointer",fontSize:11}}>Skip</button>
        </div>
        <div style={{padding:24}}>
          <div onClick={flip} style={{cursor:"pointer",background:flipped?"linear-gradient(135deg,#1a4a2e,#0e3020)":C.card,border:`2px solid ${flipped?C.gold:C.border}`,borderRadius:16,padding:"24px 20px",textAlign:"center",marginBottom:16,minHeight:120,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",transition:"all .3s"}}>
            {!flipped?<>
              <div style={{fontFamily:"'Noto Sans Malayalam',sans-serif",fontSize:"3.5em",color:C.gold,lineHeight:1,marginBottom:6}}>{card.vowel}</div>
              <div style={{fontSize:13,color:C.muted,whiteSpace:"pre-line"}}>{card.front.replace(card.vowel,"").trim()}</div>
              <div style={{fontSize:11,color:C.muted,marginTop:8,opacity:.6}}>👆 Tap to reveal</div>
            </>:<>
              <div style={{fontFamily:"'Noto Sans Malayalam',sans-serif",fontSize:"2.5em",color:C.goldL,lineHeight:1,marginBottom:8}}>{card.vowel}</div>
              <div style={{fontSize:13,color:"rgba(255,255,255,.85)",whiteSpace:"pre-line",lineHeight:1.6}}>{card.back}</div>
              <button onClick={e=>{e.stopPropagation();if(onSpeak)onSpeak(card.vowel);}} style={{marginTop:10,background:"rgba(200,134,10,.25)",border:`1px solid ${C.gold}`,borderRadius:20,padding:"4px 14px",color:C.goldL,fontSize:12,cursor:"pointer"}}>🔊 Hear Pronunciation</button>
            </>}
          </div>
          <div style={{background:"rgba(14,102,116,.07)",borderLeft:`3px solid ${C.teal}`,borderRadius:"0 10px 10px 0",padding:"9px 14px",marginBottom:12,fontSize:13,fontWeight:600,color:C.text}}>❓ {card.q}</div>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {card.opts.map((opt,i)=>{
              let bg=C.card,bdr=C.border,clr=C.text,ico="";
              if(answered!==null){if(i===card.ans){bg="rgba(30,107,60,.1)";bdr=C.green;clr=C.green;ico="✓ ";}else if(i===answered){bg="rgba(176,48,32,.1)";bdr=C.red;clr=C.red;ico="✗ ";}}
              return(<div key={i} onClick={()=>answer(i)} style={{display:"flex",alignItems:"center",gap:10,background:bg,border:`1.5px solid ${bdr}`,borderRadius:10,padding:"10px 14px",cursor:answered===null?"pointer":"default",color:clr,transition:"all .2s",fontFamily:"'Noto Sans Malayalam',sans-serif",fontSize:14}}>
                <div style={{width:24,height:24,borderRadius:7,background:"rgba(160,120,64,.12)",fontSize:11,fontWeight:700,color:C.muted,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{String.fromCharCode(65+i)}</div>
                {ico}{opt}
              </div>);
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ══ EXAM CARD — single flashcard question used in the 50-Q final exam ════════
function ExamCard({card,lm,onAnswer,onSpeak,score,total}){
  const [flipped,setFlipped]=useState(false);
  const [answered,setAnswered]=useState(null);

  function flip(){
    if(!flipped){setFlipped(true);if(onSpeak)onSpeak(card.vowel+" "+card.q);}
  }
  function answer(i){
    if(answered!==null)return;
    setAnswered(i);
    setTimeout(()=>onAnswer(i===card.ans),900);
  }

  return(
    <div style={{padding:"20px 22px"}}>
      {/* Score ticker */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:11,color:C.muted}}>✅ {score} correct so far</div>
        <div style={{fontSize:11,color:C.muted}}>❌ {total-score} incorrect</div>
      </div>

      {/* Flashcard face */}
      <div onClick={flip} style={{cursor:flipped?"default":"pointer",background:flipped?"linear-gradient(135deg,#1a4a2e,#0e3020)":C.card,border:`2px solid ${flipped?lm.color:C.border}`,borderRadius:16,padding:"22px 18px",textAlign:"center",marginBottom:14,minHeight:110,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",transition:"all .3s"}}>
        {!flipped?(
          <>
            <div style={{fontFamily:"'Noto Sans Malayalam',sans-serif",fontSize:"2.8em",color:C.gold,lineHeight:1.1,marginBottom:6}}>{card.vowel}</div>
            <div style={{fontSize:13,color:C.muted,lineHeight:1.5}}>{card.front}</div>
            <div style={{fontSize:10,color:C.muted,marginTop:10,opacity:.5}}>👆 Tap card to reveal hint</div>
          </>
        ):(
          <>
            <div style={{fontFamily:"'Noto Sans Malayalam',sans-serif",fontSize:"2em",color:C.goldL,lineHeight:1.1,marginBottom:8}}>{card.vowel}</div>
            <div style={{fontSize:12,color:"rgba(255,255,255,.82)",whiteSpace:"pre-line",lineHeight:1.6}}>{card.back}</div>
            <button onClick={e=>{e.stopPropagation();if(onSpeak)onSpeak(card.back.split("\n")[0]);}} style={{marginTop:10,background:"rgba(200,134,10,.2)",border:`1px solid ${C.gold}`,borderRadius:20,padding:"3px 13px",color:C.goldL,fontSize:11,cursor:"pointer"}}>🔊 Listen</button>
          </>
        )}
      </div>

      {/* Question */}
      <div style={{background:"rgba(14,102,116,.08)",borderLeft:`3px solid ${lm.color}`,borderRadius:"0 10px 10px 0",padding:"9px 14px",marginBottom:12,fontSize:14,fontWeight:600,color:C.text,fontFamily:"'Noto Sans Malayalam',sans-serif"}}>
        ❓ {card.q}
      </div>

      {/* Options */}
      <div style={{display:"flex",flexDirection:"column",gap:7}}>
        {card.opts.map((opt,i)=>{
          let bg=C.card,bdr=C.border,clr=C.text,ico="";
          if(answered!==null){
            if(i===card.ans){bg="rgba(30,107,60,.12)";bdr=C.green;clr=C.green;ico="✓ ";}
            else if(i===answered){bg="rgba(176,48,32,.1)";bdr=C.red;clr=C.red;ico="✗ ";}
          }
          return(
            <div key={i} onClick={()=>answer(i)}
              style={{display:"flex",alignItems:"center",gap:10,background:bg,border:`1.5px solid ${bdr}`,borderRadius:10,padding:"10px 14px",cursor:answered===null?"pointer":"default",color:clr,fontFamily:"'Noto Sans Malayalam',sans-serif",fontSize:14,transition:"all .2s"}}>
              <div style={{width:26,height:26,borderRadius:8,background:"rgba(160,120,64,.12)",fontSize:11,fontWeight:700,color:C.muted,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{String.fromCharCode(65+i)}</div>
              {ico}{opt}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══ EXAM RESULT — shown after all 50 questions ════════════════════════════════
function ExamResult({score,total,lm,level}){
  const pct=Math.round(score/total*100);
  const grade=pct>=90?"🏆 Outstanding!":pct>=80?"🌟 Excellent!":pct>=70?"👍 Good job!":pct>=60?"📖 Satisfactory":"💪 Keep practising!";
  const nextLevel={basic:"Intermediate",intermediate:"Advanced",advanced:null};
  const canAdvance=pct>=70&&nextLevel[level];
  return(
    <div style={{padding:"24px 22px",textAlign:"center"}}>
      {/* Big score */}
      <div style={{fontSize:72,fontWeight:900,color:lm.color,lineHeight:1,marginBottom:4}}>{pct}%</div>
      <div style={{fontSize:22,margin:"8px 0 4px"}}>{grade}</div>
      <div style={{fontSize:14,color:C.muted,marginBottom:18}}>{score} / {total} correct</div>

      {/* Grade breakdown bar */}
      <div style={{background:"rgba(160,120,64,.12)",borderRadius:8,height:10,marginBottom:20,overflow:"hidden"}}>
        <div style={{height:"100%",borderRadius:8,background:`linear-gradient(90deg,${lm.color},${lm.light})`,width:`${pct}%`,transition:"width 1s ease"}}/>
      </div>

      {/* Grade bands */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:5,marginBottom:20}}>
        {[[90,"A+","#e8a820"],[80,"A","#4ade80"],[70,"B","#22d3ee"],[60,"C","#a78bfa"],[0,"D","#ff6b5b"]].map(([min,gr,col])=>(
          <div key={gr} style={{background:pct>=min?col+"20":"rgba(160,120,64,.06)",border:`1px solid ${pct>=min?col:"rgba(160,120,64,.15)"}`,borderRadius:8,padding:"6px 4px",textAlign:"center"}}>
            <div style={{fontSize:14,fontWeight:800,color:pct>=min?col:"rgba(160,120,64,.3)"}}>{gr}</div>
            <div style={{fontSize:9,color:C.muted}}>{min}%+</div>
          </div>
        ))}
      </div>

      {canAdvance&&(
        <div style={{background:`rgba(30,107,60,.1)`,border:`1px solid ${C.green}`,borderRadius:12,padding:"12px 16px",marginBottom:12,fontSize:13,color:C.green,fontWeight:600}}>
          🎉 You're ready to advance to <strong>{nextLevel[level]}</strong> level!
        </div>
      )}
      {!canAdvance&&pct<70&&(
        <div style={{background:"rgba(176,48,32,.08)",border:`1px solid ${C.red}`,borderRadius:12,padding:"12px 16px",marginBottom:12,fontSize:13,color:C.red}}>
          Review your lessons and try again. You need 70% to advance.
        </div>
      )}
      {level==="advanced"&&pct>=80&&(
        <div style={{background:"linear-gradient(135deg,rgba(200,134,10,.15),rgba(200,134,10,.05))",border:`1px solid ${C.gold}`,borderRadius:12,padding:"14px 16px",marginBottom:12,fontSize:14,color:C.gold,fontWeight:700}}>
          🏆 Congratulations! You have mastered Malayalam!
        </div>
      )}
    </div>
  );
}

// ══ TUTOR APP ═════════════════════════════════════════════════════════════════
function TutorApp({user,progress,updateProgress,level,day,onDashboard}){
  const [msgs,setMsgs]=useState([]);const [input,setInput]=useState("");const [busy,setBusy]=useState(false);
  const [detail,setDetail]=useState(null);const [testOpen,setTestOpen]=useState(false);
  const [examQ,setExamQ]=useState([]);const [examIdx,setExamIdx]=useState(0);const [examScore,setExamScore]=useState(0);const [examDone,setExamDone]=useState(false);
  const [xp,setXp]=useState(progress.xp||0);const [words,setWords]=useState(progress.words||0);const [secs,setSecs]=useState(2400);
  const [speaking,setSpeaking]=useState(false);const [paused,setPaused]=useState(false);const [audioOn,setAudioOn]=useState(false);const [speechOn,setSpeechOn]=useState(true);
  const [flashcard,setFlashcard]=useState(null);const [fcIdx,setFcIdx]=useState(0);
  const logRef=useRef([]);const msgsEnd=useRef(null);const booted=useRef(false);const msgCount=useRef(0);

  const dayInfo=CURRICULUM[level]?.find(d=>d.day===day)||CURRICULUM[level]?.[day-1]||CURRICULUM[level]?.[0];
  const topic=dayInfo?.topic||"vowels";
  const lm=LEVEL_META[level];
  const finalTests=FINAL_TESTS[level]||FINAL_TESTS.basic;
  const cards=getTopicCards(level, topic);

  // Poll engine state every 200ms to keep React in sync with speech engine
  useEffect(()=>{
    const t=setInterval(()=>{
      setSpeaking(isSpeaking());
      setPaused(isSpeechPaused());
    },200);
    return()=>clearInterval(t);
  },[]);

  useEffect(()=>{const t=setInterval(()=>setSecs(s=>Math.max(0,s-1)),1000);return()=>clearInterval(t);},[]);
  useEffect(()=>{msgsEnd.current?.scrollIntoView({behavior:"smooth"});},[msgs]);
  useEffect(()=>{if(!booted.current){booted.current=true;doCall(`Hello! I'm ${user.name}. I'm ready to learn. My level is ${level} and today is Day ${day}: ${dayInfo?.t||"lesson"}.`);}},[]);
  useEffect(()=>{updateProgress({xp,words,minutesSpent:Math.floor((2400-secs)/60)});},[xp,words,secs]);
  useEffect(()=>{setFcIdx(0);},[topic]);

  function doUnlock(){if(audioOn)return;unlockAudio();setAudioOn(true);}

  function autoSpeak(text){
    if(!speechOn)return;
    if(!audioOn){unlockAudio();setAudioOn(true);}
    // Small delay so unlock utterance finishes first
    setTimeout(()=>speakMsg(text),400);
  }

  function stopSpk(){stopSpeech();}
  function pauseSpk(){pauseSpeech();}
  function resumeSpk(){resumeSpeech();}

  // Called when student clicks the 🃏 button — only shows cards for current lesson topic
  function showFlashcard(){
    const i=fcIdx%cards.length;
    setFcIdx(n=>n+1);
    setFlashcard(cards[i]);
  }

  async function doCall(userText){
    let newLog;
    const sysMsg=getSystemMsg(level,day,topic,user.name);
    if(logRef.current.length===0){newLog=[{role:"user",content:sysMsg+"\n\nStudent says: "+userText}];}
    else{newLog=[...logRef.current,{role:"user",content:userText}];}
    setBusy(true);
    setMsgs(m=>[...m,...(logRef.current.length>0?[{role:"user",text:userText}]:[]),{role:"typing"}]);
    try{
      const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1024,messages:newLog})});
      const data=await res.json();
      if(!res.ok)throw new Error(data?.error?.message||"Error "+res.status);
      const reply=data?.content?.find(b=>b.type==="text")?.text||"";
      if(!reply)throw new Error("No response");
      logRef.current=[...newLog,{role:"assistant",content:reply}];
      const m=reply.match(/[\u0D00-\u0D7F]+/g);if(m)setWords(w=>w+Math.min(m.length,3));
      setXp(x=>x+10);
      // Count teacher responses; show quiz button only after 2nd response (not on intro)
      msgCount.current+=1;
      const showQuiz=msgCount.current>=2;
      setMsgs(prev=>[...prev.filter(m=>m.role!=="typing"),{role:"teacher",text:reply,showQuiz}]);
      autoSpeak(reply);
    }catch(e){
      logRef.current=newLog.slice(0,-1);
      setMsgs(prev=>[...prev.filter(m=>m.role!=="typing"),{role:"teacher",text:"Sorry, connection issue: "+e.message}]);
    }
    setBusy(false);
  }

  function send(txt){const t=(txt||input).trim();if(!t||busy)return;setInput("");doCall(t);}
  function onKey(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}

  function openExam(){
    // Shuffle all 50 questions for variety
    const shuffled=[...finalTests].sort(()=>Math.random()-.5);
    setExamQ(shuffled);setExamIdx(0);setExamScore(0);setExamDone(false);setTestOpen(true);
  }
  function resetExam(){setExamIdx(0);setExamScore(0);setExamDone(false);setExamQ([...finalTests].sort(()=>Math.random()-.5));}
  function handleExamAnswer(correct){
    const ns=examScore+(correct?1:0);
    const ni=examIdx+1;
    if(ni>=examQ.length){
      const pct=Math.round(ns/examQ.length*100);
      updateProgress({testScores:[...(progress.testScores||[]),pct]});
      setExamScore(ns);setExamDone(true);
      if(correct)setXp(x=>x+20);
    } else {
      if(correct)setXp(x=>x+10);
      setExamScore(ns);setExamIdx(ni);
    }
  }

  const timer=`${String(Math.floor(secs/60)).padStart(2,"0")}:${String(secs%60).padStart(2,"0")}`;
  const progPct=Math.min(96,(logRef.current.filter(m=>m.role==="user").length/14)*100);

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100vh",fontFamily:"'Segoe UI',system-ui,sans-serif",background:C.bg,overflow:"hidden"}}>
      {/* Topbar */}
      <div style={{height:56,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 14px",background:"linear-gradient(90deg,#140c00,#2a1500,#140c00)",borderBottom:`2px solid ${lm.color}`,flexShrink:0,boxShadow:"0 3px 20px rgba(0,0,0,.4)"}}>
        <Logo/>
        <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"nowrap"}}>
          {/* Level badge */}
          <div style={{padding:"3px 10px",borderRadius:20,background:lm.bg,border:`1px solid ${lm.color}`,fontSize:11,color:lm.light,fontWeight:700}}>{lm.icon} {lm.label}</div>
          <div style={{padding:"4px 10px",borderRadius:20,background:"rgba(255,255,255,.06)",border:`1px solid rgba(200,134,10,.3)`,fontSize:12,color:C.goldL,fontWeight:600}}>⭐ {xp}</div>
          <div style={{padding:"4px 10px",borderRadius:20,background:"rgba(255,255,255,.06)",border:`1px solid rgba(200,134,10,.3)`,fontSize:12,color:C.goldL,fontWeight:600}}>📖 {words}</div>
          {/* Sound controls — always visible once audio enabled */}
          <button onClick={()=>{setSpeechOn(s=>{if(s)stopSpk();return!s;})}} title={speechOn?"Mute auto-speech":"Unmute"} style={{background:speechOn?"rgba(200,134,10,.2)":"rgba(255,255,255,.06)",border:`1.5px solid ${speechOn?C.gold:"rgba(255,255,255,.15)"}`,color:speechOn?C.goldL:"rgba(255,255,255,.4)",padding:"4px 9px",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:700}}>{speechOn?"🔊":"🔇"}</button>
          {audioOn&&(<>
            {paused?(
              <button onClick={resumeSpk} title="Resume speaking" style={{background:"rgba(30,107,60,.3)",border:"1.5px solid #4ade80",color:"#4ade80",padding:"4px 12px",borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:800,animation:"pulse 1s infinite"}}>▶</button>
            ):(
              <button onClick={pauseSpk} title="Pause speaking" style={{background:speaking?"rgba(14,102,116,.25)":"rgba(255,255,255,.04)",border:`1.5px solid ${speaking?"rgba(14,102,116,.6)":"rgba(255,255,255,.1)"}`,color:speaking?"#67e8f9":"rgba(255,255,255,.25)",padding:"4px 12px",borderRadius:8,cursor:speaking?"pointer":"default",fontSize:14,fontWeight:800}}>⏸</button>
            )}
            <button onClick={stopSpk} title="Stop speaking" style={{background:(speaking||paused)?"rgba(176,48,32,.25)":"rgba(255,255,255,.04)",border:`1.5px solid ${(speaking||paused)?"rgba(176,48,32,.6)":"rgba(255,255,255,.1)"}`,color:(speaking||paused)?"#ff6b5b":"rgba(255,255,255,.25)",padding:"4px 12px",borderRadius:8,cursor:(speaking||paused)?"pointer":"default",fontSize:14,fontWeight:800}}>⏹</button>
          </>)}
          <button onClick={openExam} style={{background:"rgba(255,170,109,.12)",border:"1px solid rgba(255,170,109,.35)",color:"#ffaa6d",padding:"4px 11px",borderRadius:8,cursor:"pointer",fontSize:11,fontWeight:600}}>📝 Final Test</button>
          <div style={{color:"rgba(255,255,255,.85)",fontSize:13,fontVariantNumeric:"tabular-nums",fontWeight:700}}>{timer}</div>
          <button onClick={onDashboard} style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.15)",color:"rgba(255,255,255,.7)",padding:"4px 11px",borderRadius:8,cursor:"pointer",fontSize:11}}>⬅ Dashboard</button>
          <div style={{width:28,height:28,borderRadius:"50%",background:"linear-gradient(135deg,#1a4a2e,#0e3020)",border:`2px solid ${lm.color}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15}}>{user.avatar}</div>
        </div>
      </div>

      <div style={{display:"flex",flex:1,overflow:"hidden"}}>
        {/* Sidebar */}
        <div style={{width:195,flexShrink:0,display:"flex",flexDirection:"column",background:"linear-gradient(180deg,#140c00,#1e1200)",borderRight:"1px solid rgba(200,134,10,.2)",overflow:"hidden"}}>
          <div style={{padding:"10px 12px 6px",fontSize:9,fontWeight:700,letterSpacing:2,textTransform:"uppercase",color:lm.light,borderBottom:`1px solid ${lm.color}33`}}>{lm.icon} {lm.label} — 30 Days</div>
          <div style={{flex:1,overflowY:"auto",padding:4}}>
            {CURRICULUM[level].map(d=>{
              const done=(progress.daysCompleted?.[level]||0)>=d.d;
              const active=d.d===day;
              return(
                <div key={d.d} style={{display:"flex",alignItems:"center",gap:7,padding:"6px 8px",borderRadius:7,marginBottom:2,fontSize:11,color:active?lm.light:done?"rgba(74,222,128,.6)":"rgba(255,255,255,.28)",background:active?`${lm.bg}`:"transparent",borderLeft:active?`3px solid ${lm.color}`:"3px solid transparent"}}>
                  <div style={{width:16,height:16,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,background:active?lm.bg:done?"rgba(74,222,128,.1)":"rgba(255,255,255,.05)",color:active?lm.light:done?"rgba(74,222,128,.8)":"rgba(255,255,255,.2)",flexShrink:0,fontWeight:700}}>
                    {active?"▶":done?"✓":d.d}
                  </div>
                  <span style={{fontSize:10,lineHeight:1.3}}>{d.t}</span>
                </div>
              );
            })}
          </div>
          <div style={{padding:7,display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,borderTop:"1px solid rgba(200,134,10,.12)"}}>
            {[["⭐",xp,"#e8a820"],["🔥","1","#ff8c42"],["📖",words,lm.light],["🎯",progress.testScores?.length?Math.max(...progress.testScores)+"%":"—","rgba(255,255,255,.7)"]].map(([l,v,c])=>(
              <div key={l} style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(200,134,10,.1)",borderRadius:7,padding:"5px 3px",textAlign:"center"}}>
                <div style={{fontSize:12,fontWeight:700,color:c}}>{v}</div>
                <div style={{fontSize:7,color:"rgba(255,255,255,.25)",textTransform:"uppercase"}}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Chat */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:C.bg}}>
          {/* Chat header */}
          <div style={{padding:"8px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",background:"#f5ead4",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:C.text}}>{lm.icon} Day {day} — {dayInfo?.t||"Lesson"}</div>
              <div style={{display:"flex",gap:4,marginTop:3}}>
                {[["Reading",C.teal],["Writing",C.green],["Speaking",C.red]].map(([t,c])=>(
                  <span key={t} style={{fontSize:10,fontWeight:600,padding:"2px 7px",borderRadius:10,background:c+"18",color:c,border:`1px solid ${c}33`}}>{t}</span>
                ))}
                <span style={{fontSize:10,color:C.muted,marginLeft:4}}>· {lm.label} Level · {user.name}</span>
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {speaking&&!paused&&<div style={{fontSize:11,color:C.teal,fontWeight:600,display:"flex",alignItems:"center",gap:4}}><span style={{animation:"pulse 1s infinite"}}>🔊</span>Speaking…</div>}
              {speaking&&paused&&<div style={{fontSize:11,color:"#a78bfa",fontWeight:600,display:"flex",alignItems:"center",gap:4}}>⏸ Paused</div>}
              <div style={{fontSize:11,color:C.muted}}>Day <strong style={{fontSize:15,color:C.text}}>{day}</strong>/30</div>
            </div>
          </div>
          <div style={{height:3,background:"rgba(160,120,64,.13)",flexShrink:0}}><div style={{height:"100%",background:`linear-gradient(90deg,${lm.color},${lm.light})`,width:`${progPct}%`,transition:"width .8s ease"}}/></div>

          {/* Audio unlock banner */}
          <div style={{padding:"5px 18px",background:audioOn?"rgba(14,102,116,.07)":"rgba(200,134,10,.1)",borderBottom:`1px solid ${audioOn?"rgba(14,102,116,.2)":"rgba(200,134,10,.25)"}`,display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
            {!audioOn?(
              <><span style={{fontSize:12}}>🔊</span><span style={{fontSize:11,color:C.gold,fontWeight:700}}>Enable audio for pronunciation:</span>
              <button onClick={()=>{
                doUnlock();
                setTimeout(()=>{
                  doSpeak("Namaskaram! Audio is now enabled. I am Meera, your Malayalam teacher from Kerala. I will speak every lesson for you. Let us begin learning together.",KERALA_RATE,KERALA_PITCH);
                  setAudioOn(true);
                },400);
              }} style={{background:`linear-gradient(135deg,${C.goldL},${C.gold})`,border:"none",borderRadius:20,padding:"3px 12px",color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer"}}>🔊 Enable Voice</button>
              <span style={{fontSize:10,color:C.muted}}>(click once)</span></>
            ):(
              <><span style={{fontSize:12}}>🎙️</span><span style={{fontSize:11,color:C.teal,fontWeight:600}}>Kerala voice active — </span><span style={{fontSize:11,color:C.text}}>Meera (en-IN) speaks each lesson. Tap 🔊 on vowel tiles to hear them.</span></>
            )}
          </div>

          {/* Messages */}
          <div style={{flex:1,overflowY:"auto",padding:"18px 22px",display:"flex",flexDirection:"column",gap:14}}>
            {msgs.map((m,i)=>{
              if(m.role==="typing")return(
                <div key={i} style={{display:"flex",gap:10}}>
                  <div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,#1a4a2e,#0e3020)",border:`2px solid rgba(200,134,10,.4)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0}}>👩‍🏫</div>
                  <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:"4px 16px 16px 16px",padding:"12px 16px"}}>
                    <div style={{display:"flex",gap:5,alignItems:"center",height:18}}>
                      {[0,.2,.4].map(d=><div key={d} style={{width:6,height:6,borderRadius:"50%",background:C.muted,animation:`bounce 1.2s ${d}s infinite`}}/>)}
                    </div>
                  </div>
                </div>
              );
              const isU=m.role==="user";
              return(
                <div key={i} style={{display:"flex",gap:10,flexDirection:isU?"row-reverse":"row",alignSelf:isU?"flex-end":"auto",maxWidth:760}}>
                  <div style={{width:36,height:36,borderRadius:"50%",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:isU?18:17,background:isU?"linear-gradient(135deg,#0e3a4a,#062030)":"linear-gradient(135deg,#1a4a2e,#0e3020)",border:isU?`2px solid ${C.teal}`:`2px solid ${lm.color}`}}>{isU?user.avatar:"👩‍🏫"}</div>
                  <div style={{padding:"12px 16px",fontSize:14,lineHeight:1.8,borderRadius:isU?"16px 4px 16px 16px":"4px 16px 16px 16px",background:isU?"linear-gradient(135deg,#0e3a4a,#0a2535)":"#fff",border:isU?`1px solid ${C.teal}33`:`1px solid ${C.border}`,color:isU?"rgba(255,255,255,.9)":C.text,boxShadow:"0 2px 10px rgba(60,30,0,.07)",maxWidth:640,whiteSpace:"pre-wrap",wordBreak:"break-word",position:"relative",paddingBottom:isU?"12px":"36px"}}>
                    {m.text}
                    {!isU&&(
                      <div style={{position:"absolute",bottom:6,right:8,display:"flex",gap:6,alignItems:"center"}}>
                        <button onClick={()=>{doUnlock();setTimeout(()=>speakMsg(m.text),200);}} style={{background:"rgba(14,102,116,.1)",border:`1px solid rgba(14,102,116,.2)`,borderRadius:20,padding:"2px 9px",color:C.teal,fontSize:10,cursor:"pointer",fontWeight:600}}>🔊 Replay</button>
                        {m.showQuiz&&(
                          <button onClick={showFlashcard} style={{background:"linear-gradient(135deg,rgba(200,134,10,.2),rgba(200,134,10,.1))",border:`1.5px solid rgba(200,134,10,.5)`,borderRadius:20,padding:"2px 11px",color:C.goldL,fontSize:10,cursor:"pointer",fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
                            🃏 Flashcard Quiz
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={msgsEnd}/>
          </div>

          {/* Vowel strip — only show for basic level */}
          {level==="basic"&&(
            <div style={{padding:"6px 12px",background:"#f0e4cc",borderTop:`1px solid rgba(160,120,64,.2)`,display:"flex",gap:4,overflowX:"auto",flexShrink:0,alignItems:"center"}}>
              <span style={{fontSize:9,color:C.muted,fontWeight:700,letterSpacing:1,textTransform:"uppercase",flexShrink:0}}>Vowels →</span>
              {VOWELS.map(v=>(
                <div key={v.ml} onClick={()=>setDetail(v)} style={{flexShrink:0,background:"#fff",border:`1.5px solid ${C.border}`,borderRadius:9,padding:"4px 8px",textAlign:"center",cursor:"pointer",minWidth:44,position:"relative"}}>
                  <div style={{fontFamily:"'Noto Sans Malayalam',sans-serif",fontSize:"1.4em",color:C.gold,fontWeight:600,lineHeight:1.2}}>{v.ml}</div>
                  <div style={{fontSize:9,color:C.muted,fontWeight:600}}>{v.tr}</div>
                  <button onClick={e=>{e.stopPropagation();doUnlock();speakVowel(v);}} style={{position:"absolute",top:-4,right:-4,width:14,height:14,borderRadius:"50%",background:C.teal,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,color:"#fff",lineHeight:1}}>🔊</button>
                </div>
              ))}
            </div>
          )}

          {/* Quick replies */}
          <div style={{padding:"6px 16px 0",background:"#f5ead4",display:"flex",gap:5,flexWrap:"wrap"}}>
            {["I understood! Next ➤","How do I pronounce this?","Give me an example","Explain more","🔊 Repeat aloud","I have a question 🤔"].map(t=>(
              <div key={t} onClick={()=>send(t)} style={{background:"#fff",border:`1.5px solid ${C.border}`,borderRadius:20,padding:"4px 10px",fontSize:11,color:"#6b4f2a",cursor:"pointer",whiteSpace:"nowrap"}}>{t}</div>
            ))}
          </div>

          {/* Input */}
          <div style={{padding:"8px 16px 12px",background:"#f5ead4",borderTop:`1px solid ${C.border}`,flexShrink:0}}>
            <div style={{display:"flex",gap:9,alignItems:"flex-end"}}>
              <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={onKey} placeholder="Type your reply… (Enter to send)" rows={1} style={{flex:1,background:"#fff",border:`1.5px solid ${C.border}`,borderRadius:13,padding:"10px 14px",color:C.text,fontSize:14,fontFamily:"inherit",resize:"none",outline:"none",minHeight:40,maxHeight:110,lineHeight:1.5}}/>
              <button onClick={()=>send()} disabled={busy} style={{width:40,height:40,borderRadius:11,border:"none",cursor:busy?"not-allowed":"pointer",background:`linear-gradient(135deg,${C.goldL},${C.gold})`,color:"#fff",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,opacity:busy?.5:1}}>➤</button>
            </div>
          </div>
        </div>
      </div>

      {/* Vowel detail modal */}
      {detail&&(
        <div onClick={()=>setDetail(null)} style={{position:"fixed",inset:0,background:"rgba(20,12,0,.8)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300}}>
          <div onClick={e=>e.stopPropagation()} style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:20,padding:26,maxWidth:370,width:"90%",boxShadow:"0 12px 60px rgba(60,30,0,.3)",animation:"slideIn .2s ease"}}>
            <div style={{textAlign:"center",fontFamily:"'Noto Sans Malayalam',sans-serif",fontSize:"5em",color:C.gold,lineHeight:1.1,marginBottom:8}}>{detail.ml}</div>
            <div style={{background:"rgba(14,102,116,.07)",border:`1px solid rgba(14,102,116,.2)`,borderRadius:12,padding:"10px 14px",marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:700,color:C.teal,marginBottom:5,textTransform:"uppercase",letterSpacing:.5}}>🎙️ Pronunciation Guide</div>
              <div style={{fontSize:13,color:C.text,lineHeight:1.7}}><strong>IPA:</strong> /{detail.ipa}/<br/><strong>Sound:</strong> {detail.hint}<br/><strong>Hindi:</strong> {detail.hi}</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7,marginBottom:12}}>
              {[["Script",detail.ml,C.gold,"'Noto Sans Malayalam',sans-serif"],["Hindi",detail.hi,C.red,"inherit"],["Sound",`"${detail.tr}"`,C.teal,"inherit"]].map(([l,v,c,ff])=>(
                <div key={l} style={{background:"#f5ead4",border:`1px solid ${C.border}`,borderRadius:10,padding:8,textAlign:"center"}}>
                  <div style={{fontSize:9,textTransform:"uppercase",letterSpacing:1,color:C.muted,marginBottom:4}}>{l}</div>
                  <div style={{fontSize:"1.4em",fontWeight:700,color:c,fontFamily:ff,lineHeight:1.2}}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{background:"rgba(14,102,116,.07)",borderLeft:`3px solid ${C.teal}`,borderRadius:"0 10px 10px 0",padding:"10px 14px",fontSize:13,color:C.text,marginBottom:12}}>📖 <strong>Example:</strong> {detail.ex}</div>
            <button onClick={()=>{doUnlock();speakVowel(detail);}} style={{width:"100%",padding:10,background:"linear-gradient(135deg,#0e6674,#094a54)",border:"none",borderRadius:12,color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",marginBottom:7}}>🔊 Hear Pronunciation</button>
            <button onClick={()=>setDetail(null)} style={{width:"100%",padding:10,background:`linear-gradient(135deg,${C.goldL},${C.gold})`,border:"none",borderRadius:12,color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>Got it! 👍</button>
          </div>
        </div>
      )}

      {/* Flashcard */}
      {flashcard&&(
        <FlashcardQuiz
          card={flashcard}
          onSpeak={ch=>{doUnlock();doSpeak(`The letter or word ${trML(ch)}. ${flashcard.back.split("\n")[0]}`,0.78);}}
          onDone={ok=>{setFlashcard(null);if(ok){setXp(x=>x+15);autoSpeak("Correct! Well done.");}else{autoSpeak("Not quite. Let us review.");}}}
          onSkip={()=>setFlashcard(null)}
        />
      )}

      {/* ── Final Exam Modal (50 flashcard questions) ── */}
      {testOpen&&(
        <div style={{position:"fixed",inset:0,background:"rgba(10,6,0,.92)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:16}}>
          <div style={{background:C.bg,border:`2px solid ${lm.color}`,borderRadius:24,maxWidth:540,width:"100%",boxShadow:"0 20px 80px rgba(0,0,0,.5)",animation:"slideIn .2s ease",overflow:"hidden",maxHeight:"96vh",display:"flex",flexDirection:"column"}}>

            {/* Header */}
            <div style={{background:`linear-gradient(135deg,#1a0e00,#2a1800)`,padding:"16px 22px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:22}}>{lm.icon}</span>
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:C.goldL}}>{lm.label} Level — Final Exam</div>
                  <div style={{fontSize:11,color:"rgba(200,134,10,.6)"}}>50 questions · Flashcard format</div>
                </div>
              </div>
              {!examDone&&<div style={{fontSize:13,fontWeight:700,color:C.goldL}}>{examIdx+1}<span style={{color:"rgba(200,134,10,.5)"}}>/{examQ.length}</span></div>}
            </div>

            {/* Progress bar */}
            {!examDone&&<div style={{height:4,background:"rgba(160,120,64,.15)",flexShrink:0}}><div style={{height:"100%",background:`linear-gradient(90deg,${lm.color},${lm.light})`,width:`${(examIdx/examQ.length)*100}%`,transition:"width .4s ease"}}/></div>}

            <div style={{overflowY:"auto",flex:1}}>
              {!examDone&&examQ.length>0?(()=>{
                const card=examQ[examIdx];
                return(
                  <ExamCard
                    key={examIdx}
                    card={card}
                    lm={lm}
                    onAnswer={handleExamAnswer}
                    onSpeak={(txt)=>{doUnlock();doSpeak(txt,0.74,KERALA_PITCH);}}
                    score={examScore}
                    total={examIdx}
                  />
                );
              })():(
                examDone&&<ExamResult score={examScore} total={examQ.length} lm={lm} level={level}/>
              )}
            </div>

            {/* Footer */}
            <div style={{padding:"12px 22px",display:"flex",gap:8,borderTop:`1px solid ${C.border}`,flexShrink:0,background:"#f5ead4"}}>
              <button onClick={()=>setTestOpen(false)} style={{background:"#fff",border:`1.5px solid ${C.border}`,borderRadius:11,padding:"9px 20px",color:"#6b4f2a",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                {examDone?"Close":"Exit Exam"}
              </button>
              {examDone&&<button onClick={resetExam} style={{background:`linear-gradient(135deg,${lm.light},${lm.color})`,border:"none",borderRadius:11,padding:"9px 22px",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>Retake ↺</button>}
              {examDone&&examScore/examQ.length>=0.7&&<button onClick={()=>setTestOpen(false)} style={{background:"linear-gradient(135deg,#e8a820,#c8860a)",border:"none",borderRadius:11,padding:"9px 22px",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>Continue →</button>}
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-6px)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}} @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}} @keyframes slideIn{from{opacity:0;transform:scale(.95)}to{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );
}
