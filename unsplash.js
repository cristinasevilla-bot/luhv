exports.handler = async (event) => {
  const { query } = event.queryStringParameters;
  const KEY = 'T4BgRaGzaOJh9wUHhThROIaSUEPIWqcdFoV11vxfGDA';
  const url = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=portrait&client_id=${KEY}`;
  
  const res = await fetch(url);
  const data = await res.json();
  
  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(data)
  };
};
