export const CONFIG = {
  TARGET_TAMBAY_HOURS: 10,
  WEIGHTS: {
    EVENTS: 0.25,        // 25% (5 events x 5%)
    SIGNATORIES: 0.15,   // 15%
    TAMBAY: 0.05,        // 5%
    INTERVIEW: 0.15,     // 15%
    OGT: 0.20,           // 20%
    CONSTI_QUIZ: 0.10,   // 10%
    BUDDY_TASKS: 0.10    // 10%
  }
};

export const OFFICIAL_EVENTS_LIST = [
  { name: "Applicants’ Orientation", weightPercent: 5 },
  { name: "Buddy Bidding", weightPercent: 5 },
  { name: "Apps Mems Bonding 1", weightPercent: 5 },
  { name: "Apps Mems Bonding 2", weightPercent: 5 },
  { name: "Apps Only Bonding", weightPercent: 5 }
];

export const PES_LIST = [
  {
    roleKey: 'PRESIDENT',
    title: 'President',
    fullName: 'Jose Miguel P. Macatangay',
    email: 'jpmacatangay1@up.edu.ph',
    photo: 'assets/pes/macatangay.jpg'
  },
  {
    roleKey: 'EVP',
    title: 'Executive Vice President',
    fullName: 'Mikaela E. Donato',
    email: 'medonato@up.edu.ph',
    photo: 'assets/pes/donato.jpg'
  },
  {
    roleKey: 'SEC_GEN',
    title: 'Secretary-General',
    fullName: 'Jo Elise G. Gulle',
    email: 'jggulle1@up.edu.ph',
    photo: 'assets/pes/gulle.jpg'
  }
];

export const COMMITTEES_LIST = [
  {
    name: 'Academics',
    vpTitle: 'Vice President for Academic Affairs',
    vp: 'Jian Christian F. Fermin',
    vpEmail: 'jffermin@up.edu.ph',
    photo: 'assets/vps/fermin.jpg'
  },
  {
    name: 'Publicity',
    vpTitle: 'Vice President for Publicity',
    vp: 'Jannah Marc D. Morales',
    vpEmail: 'jdmorales3@up.edu.ph',
    photo: 'assets/vps/morales.jpg'
  },
  {
    name: 'RAComm',
    vpTitle: 'Vice President for Recruitment and Applications',
    vp: 'Sandra Lee S. Polinar',
    vpEmail: 'sspolinar1@up.edu.ph',
    photo: 'assets/vps/polinar.jpg'
  },
  {
    name: 'Internal',
    vpTitle: 'Vice President for Internal Affairs',
    vp: 'Cian Joseph M. Catimbang',
    vpEmail: 'cmcatimbang@up.edu.ph',
    photo: 'assets/vps/catimbang.jpg'
  },
  {
    name: 'External',
    vpTitle: 'Vice President for External Affairs',
    vp: 'Queenie C. Necesario',
    vpEmail: 'qcnecesario@up.edu.ph',
    photo: 'assets/vps/necesario.jpg'
  },
  {
    name: 'Finance',
    vpTitle: 'Vice President for Finance',
    vp: 'Regine Ann C. Reyes',
    vpEmail: 'rcreyes18@up.edu.ph',
    photo: 'assets/vps/reyes.jpg'
  }
];
