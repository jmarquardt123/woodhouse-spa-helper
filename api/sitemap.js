// GET /sitemap.xml — home + all 94 location pages, for Search Console.
const { registry } = require("./_lib/locations");

module.exports = async (req, res) => {
  const base = "https://woodhouseopenings.com";
  const urls = ['<url><loc>'+base+'/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>'];
  for (const l of registry.locations) {
    urls.push('<url><loc>'+base+'/spa/'+l.key+'</loc><changefreq>hourly</changefreq><priority>0.8</priority></url>');
  }
  res.statusCode = 200;
  res.setHeader("content-type", "application/xml; charset=utf-8");
  res.setHeader("cache-control", "public, s-maxage=3600");
  res.end('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">\n' + urls.join("\n") + '\n</urlset>');
};
