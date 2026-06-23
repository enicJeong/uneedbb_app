const BB_CONFIG = {
  API: 'https://bb-api.enic.workers.dev',

  PRODUCTS: [
    { name: '(3.5만)', price: 35000, color: { bg:'#fef3c7', border:'#fbbf24', text:'#92400e', qty:'#fde68a' } },
    { name: '(3.0만)', price: 30000, color: { bg:'#dbeafe', border:'#60a5fa', text:'#1e3a8a', qty:'#bfdbfe' } },
    { name: '(2.5만)', price: 25000, color: { bg:'#f0fdf4', border:'#4ade80', text:'#14532d', qty:'#bbf7d0' } },
    { name: '(2.0만)', price: 20000, color: { bg:'#fce7f3', border:'#f472b6', text:'#831843', qty:'#fbcfe8' } },
    { name: '(즙)',    price: 0,     color: { bg:'#f3e8ff', border:'#c084fc', text:'#581c87', qty:'#e9d5ff' } },
  ],

  DELIVERY_TYPES: ['택배', '현장수령', '배달'],

  PRICE_MAP: {
    '3.5만': 35000, '35000': 35000,
    '3만':   30000, '3.0만': 30000, '30000': 30000,
    '2.5만': 25000, '25000': 25000,
    '2만':   20000, '2.0만': 20000, '20000': 20000,
    '즙':    0,
  },
};