/**
 * US state public-records statutes, so a request can cite the right law and its
 * statutory response deadline. Deadlines are the initial acknowledgement/production
 * window in the statute; many states allow extensions. Advisory, not legal advice.
 */
export interface RecordsLaw {
  code: string;
  name: string;
  law: string;
  citation: string;
  /** Statutory response window, as the statute phrases it. */
  deadline: string;
}

export const RECORDS_LAWS: RecordsLaw[] = [
  { code: 'AL', name: 'Alabama', law: 'Alabama Public Records Law', citation: 'Ala. Code § 36-12-40', deadline: 'acknowledgement within 10 business days' },
  { code: 'AK', name: 'Alaska', law: 'Alaska Public Records Act', citation: 'Alaska Stat. § 40.25.110', deadline: '10 working days' },
  { code: 'AZ', name: 'Arizona', law: 'Arizona Public Records Law', citation: 'A.R.S. § 39-121', deadline: 'promptly' },
  { code: 'AR', name: 'Arkansas', law: 'Arkansas Freedom of Information Act', citation: 'Ark. Code § 25-19-105', deadline: '3 working days' },
  { code: 'CA', name: 'California', law: 'California Public Records Act', citation: 'Cal. Gov. Code § 7920.000 et seq.', deadline: '10 calendar days' },
  { code: 'CO', name: 'Colorado', law: 'Colorado Open Records Act', citation: 'C.R.S. § 24-72-203', deadline: '3 working days' },
  { code: 'CT', name: 'Connecticut', law: 'Connecticut Freedom of Information Act', citation: 'Conn. Gen. Stat. § 1-210', deadline: '4 business days' },
  { code: 'DE', name: 'Delaware', law: 'Delaware Freedom of Information Act', citation: '29 Del. C. § 10003', deadline: '15 business days' },
  { code: 'DC', name: 'District of Columbia', law: 'D.C. Freedom of Information Act', citation: 'D.C. Code § 2-532', deadline: '15 business days' },
  { code: 'FL', name: 'Florida', law: 'Florida Public Records Act (Sunshine Law)', citation: 'Fla. Stat. § 119.07', deadline: 'promptly and in good faith' },
  { code: 'GA', name: 'Georgia', law: 'Georgia Open Records Act', citation: 'O.C.G.A. § 50-18-71', deadline: '3 business days' },
  { code: 'HI', name: 'Hawaii', law: 'Uniform Information Practices Act', citation: 'Haw. Rev. Stat. § 92F-11', deadline: '10 business days' },
  { code: 'ID', name: 'Idaho', law: 'Idaho Public Records Act', citation: 'Idaho Code § 74-103', deadline: '3 working days' },
  { code: 'IL', name: 'Illinois', law: 'Illinois Freedom of Information Act', citation: '5 ILCS 140/3', deadline: '5 business days' },
  { code: 'IN', name: 'Indiana', law: 'Indiana Access to Public Records Act', citation: 'Ind. Code § 5-14-3-9', deadline: '7 days (written request)' },
  { code: 'IA', name: 'Iowa', law: 'Iowa Open Records Law', citation: 'Iowa Code § 22.8', deadline: 'reasonable time, generally 10–20 days' },
  { code: 'KS', name: 'Kansas', law: 'Kansas Open Records Act', citation: 'K.S.A. § 45-218', deadline: '3 business days' },
  { code: 'KY', name: 'Kentucky', law: 'Kentucky Open Records Act', citation: 'KRS § 61.880', deadline: '5 business days' },
  { code: 'LA', name: 'Louisiana', law: 'Louisiana Public Records Law', citation: 'La. R.S. 44:32', deadline: '3 business days' },
  { code: 'ME', name: 'Maine', law: 'Maine Freedom of Access Act', citation: '1 M.R.S. § 408-A', deadline: 'acknowledgement within 5 working days' },
  { code: 'MD', name: 'Maryland', law: 'Maryland Public Information Act', citation: 'Md. Code, Gen. Prov. § 4-203', deadline: '30 days' },
  { code: 'MA', name: 'Massachusetts', law: 'Massachusetts Public Records Law', citation: 'M.G.L. c. 66, § 10', deadline: '10 business days' },
  { code: 'MI', name: 'Michigan', law: 'Michigan Freedom of Information Act', citation: 'MCL § 15.235', deadline: '5 business days' },
  { code: 'MN', name: 'Minnesota', law: 'Minnesota Government Data Practices Act', citation: 'Minn. Stat. § 13.03', deadline: 'promptly' },
  { code: 'MS', name: 'Mississippi', law: 'Mississippi Public Records Act', citation: 'Miss. Code § 25-61-5', deadline: '7 working days' },
  { code: 'MO', name: 'Missouri', law: 'Missouri Sunshine Law', citation: 'RSMo § 610.023', deadline: '3 business days' },
  { code: 'MT', name: 'Montana', law: 'Montana Public Records Act', citation: 'Mont. Code § 2-6-1006', deadline: 'promptly' },
  { code: 'NE', name: 'Nebraska', law: 'Nebraska Public Records Statutes', citation: 'Neb. Rev. Stat. § 84-712', deadline: '4 business days' },
  { code: 'NV', name: 'Nevada', law: 'Nevada Public Records Act', citation: 'NRS § 239.0107', deadline: '5 business days' },
  { code: 'NH', name: 'New Hampshire', law: 'New Hampshire Right-to-Know Law', citation: 'RSA 91-A:4', deadline: '5 business days' },
  { code: 'NJ', name: 'New Jersey', law: 'New Jersey Open Public Records Act', citation: 'N.J.S.A. 47:1A-5', deadline: '7 business days' },
  { code: 'NM', name: 'New Mexico', law: 'New Mexico Inspection of Public Records Act', citation: 'NMSA § 14-2-8', deadline: '15 calendar days' },
  { code: 'NY', name: 'New York', law: 'New York Freedom of Information Law', citation: 'N.Y. Pub. Off. Law § 89', deadline: 'acknowledgement within 5 business days' },
  { code: 'NC', name: 'North Carolina', law: 'North Carolina Public Records Law', citation: 'N.C. Gen. Stat. § 132-6', deadline: 'as promptly as possible' },
  { code: 'ND', name: 'North Dakota', law: 'North Dakota Open Records Statute', citation: 'N.D.C.C. § 44-04-18', deadline: 'reasonable time' },
  { code: 'OH', name: 'Ohio', law: 'Ohio Public Records Act', citation: 'Ohio Rev. Code § 149.43', deadline: 'reasonable period of time' },
  { code: 'OK', name: 'Oklahoma', law: 'Oklahoma Open Records Act', citation: '51 O.S. § 24A.5', deadline: 'prompt, reasonable access' },
  { code: 'OR', name: 'Oregon', law: 'Oregon Public Records Law', citation: 'ORS § 192.324', deadline: 'acknowledgement within 5 business days; completion within 10' },
  { code: 'PA', name: 'Pennsylvania', law: 'Pennsylvania Right-to-Know Law', citation: '65 P.S. § 67.901', deadline: '5 business days' },
  { code: 'RI', name: 'Rhode Island', law: 'Rhode Island Access to Public Records Act', citation: 'R.I. Gen. Laws § 38-2-3', deadline: '10 business days' },
  { code: 'SC', name: 'South Carolina', law: 'South Carolina Freedom of Information Act', citation: 'S.C. Code § 30-4-30', deadline: '10 business days' },
  { code: 'SD', name: 'South Dakota', law: 'South Dakota Sunshine Law', citation: 'SDCL § 1-27-37', deadline: '10 business days' },
  { code: 'TN', name: 'Tennessee', law: 'Tennessee Public Records Act', citation: 'Tenn. Code § 10-7-503', deadline: '7 business days' },
  { code: 'TX', name: 'Texas', law: 'Texas Public Information Act', citation: 'Tex. Gov. Code § 552.221', deadline: 'promptly; 10 business days if withholding is sought' },
  { code: 'UT', name: 'Utah', law: 'Government Records Access and Management Act', citation: 'Utah Code § 63G-2-204', deadline: '10 business days' },
  { code: 'VT', name: 'Vermont', law: 'Vermont Public Records Act', citation: '1 V.S.A. § 318', deadline: '3 business days' },
  { code: 'VA', name: 'Virginia', law: 'Virginia Freedom of Information Act', citation: 'Va. Code § 2.2-3704', deadline: '5 working days' },
  { code: 'WA', name: 'Washington', law: 'Washington Public Records Act', citation: 'RCW § 42.56.520', deadline: '5 business days' },
  { code: 'WV', name: 'West Virginia', law: 'West Virginia Freedom of Information Act', citation: 'W. Va. Code § 29B-1-3', deadline: '5 business days' },
  { code: 'WI', name: 'Wisconsin', law: 'Wisconsin Public Records Law', citation: 'Wis. Stat. § 19.35', deadline: 'as soon as practicable and without delay' },
  { code: 'WY', name: 'Wyoming', law: 'Wyoming Public Records Act', citation: 'Wyo. Stat. § 16-4-202', deadline: 'acknowledgement within 7 business days; production within 30' },
];

const byKey = new Map<string, RecordsLaw>();
for (const l of RECORDS_LAWS) {
  byKey.set(l.code.toLowerCase(), l);
  byKey.set(l.name.toLowerCase(), l);
}

/** Look up by USPS code or full name as geocoders return it ("GA", "Georgia"). */
export function recordsLawFor(state: string | undefined): RecordsLaw | null {
  if (!state) return null;
  return byKey.get(state.trim().toLowerCase()) ?? null;
}

/** MuckRock agency directory search for an operator string: contacts, past requests, one-click filing. */
export function muckrockAgencyUrl(operator: string): string {
  return `https://www.muckrock.com/agency/?q=${encodeURIComponent(operator)}`;
}
