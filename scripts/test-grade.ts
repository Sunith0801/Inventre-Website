import { extractGrade } from "../lib/grade";

const samples = [
  "WM JK Magic Box Girls Grade 9",
  "WM JK Grade 9 BookkitKannada",
  "Sparsh Grade 9",
  "Computer applications by Sumita Arora Gr IX",
  "First Flight",
  "WM JK Maroon Polo",
  "CM Crown 200 pages Single ruled",
  "Bundle 13 Notebook",
  "WM JK Magic Box Boys UKG",
  "Magic Box LKG",
  "Magic Box Nursery",
  "WM JK Grade 12 Bookkit",
  "Class 8 Science Textbook",
  "gr.5 textbook",
  "Gr-IX science",
];

for (const s of samples) {
  console.log(JSON.stringify(s).padEnd(60), "->", extractGrade(s));
}
