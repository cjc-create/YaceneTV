const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const BASE_URL = 'https://d.syrlive.com/matches-today/';

/**
 * دالة لاستخراج الرابط المباشر m3u8 من المشغل
 * تم تحديثها لتتعامل مع حماية المشغلات الجديدة
 */
async function getDirectStream(iframeUrl) {
    if (!iframeUrl) return "";
    
    // تصحيح الرابط إذا كان يبدأ بـ //
    const fullIframeUrl = iframeUrl.startsWith('//') ? `https:${iframeUrl}` : iframeUrl;

    try {
        const { data } = await axios.get(fullIframeUrl, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://d.syrlive.com/',
                'Origin': 'https://d.syrlive.com',
                'Accept': '*/*'
            },
            timeout: 10000 
        });

        // 1. البحث عن روابط m3u8 الصريحة
        const m3u8Regex = /https?[:\/\w\.-]+\.m3u8[^\s"']*/gi;
        let matches = data.match(m3u8Regex);

        if (matches && matches.length > 0) {
            // تنظيف الرابط من أي علامات هروب (Backslashes)
            return matches[0].replace(/\\/g, ''); 
        }

        // 2. البحث عن الروابط داخل سمة "source" في المشغل
        const sourceRegex = /file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i;
        const sourceMatch = data.match(sourceRegex);
        if (sourceMatch) return sourceMatch[1];

        // 3. البحث عن روابط Base64 (إذا كان المشغل يشفر الرابط)
        const base64Regex = /["']([A-Za-z0-9+/]{50,})={0,2}["']/g;
        let b64Matches;
        while ((b64Matches = base64Regex.exec(data)) !== null) {
            try {
                let decoded = Buffer.from(b64Matches[1], 'base64').toString('utf-8');
                if (decoded.includes('.m3u8')) {
                    return decoded.match(/https?[:\/\w\.-]+\.m3u8[^\s"']*/i)[0];
                }
            } catch (e) {}
        }

        return "";
    } catch (e) {
        console.log(`⚠️ فشل الوصول للمشغل: ${fullIframeUrl}`);
        return "";
    }
}

/**
 * فحص صفحة المباراة لجلب السيرفر والرابط المباشر
 */
async function processMatchStream(matchUrl) {
    let result = { iframe: "", direct: "" };
    try {
        const { data } = await axios.get(matchUrl, { 
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 8000 
        });
        const $ = cheerio.load(data);
        
        // جلب رابط الـ iframe مع دعم المشغل الجديد
        const iframeSrc = $('iframe').attr('src') || $('iframe.cf').attr('src') || "";
        result.iframe = iframeSrc;

        if (iframeSrc) {
            result.direct = await getDirectStream(iframeSrc);
        }
    } catch (e) {
        console.log(`⚠️ فشل جلب صفحة المباراة: ${matchUrl}`);
    }
    return result;
}

/**
 * السكريبت الرئيسي
 */
async function scrapeMatches() {
    try {
        console.log("🚀 جاري فحص المباريات واستخراج البيانات...");
        const { data } = await axios.get(BASE_URL, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' 
            }
        });
        const $ = cheerio.load(data);
        const matches = [];

        const matchElements = $('.match-container');

        for (let i = 0; i < matchElements.length; i++) {
            const el = matchElements[i];
            const detailsUrl = $(el).find('a').attr('href') || "";
            
            const getValidLogo = (sideSelector) => {
                const imgTag = $(el).find(`${sideSelector} img`);
                let logoUrl = imgTag.attr('data-src') || imgTag.attr('src') || "";
                if (logoUrl.startsWith('//')) logoUrl = 'https:' + logoUrl;
                return logoUrl;
            };

            const match = {
                team1: $(el).find('.right-team .team-name').text().trim(),
                team1Logo: getValidLogo('.right-team'),
                team2: $(el).find('.left-team .team-name').text().trim(),
                team2Logo: getValidLogo('.left-team'),
                time: $(el).find('.match-time').text().trim(),
                status: $(el).find('.date').text().trim(),
                channel: $(el).find('.match-info ul li:nth-child(1) span').text().trim(),
                league: $(el).find('.match-info ul li:nth-child(3) span').text().trim(),
                streamUrl: "", 
                stream: ""     
            };

            if (detailsUrl) {
                console.log(`🔍 جاري استخراج: ${match.team1} vs ${match.team2}`);
                const streamData = await processMatchStream(detailsUrl);
                
                match.streamUrl = streamData.iframe;
                match.stream = streamData.direct;
                
                if (match.stream) {
                    console.log(`✅ تم العثور على الرابط المباشر!`);
                } else {
                    console.log(`❌ لم يتم العثور على رابط مباشر (قد يكون البث لم يبدأ بعد)`);
                }
            }

            matches.push(match);
        }

        fs.writeFileSync('matches.json', JSON.stringify(matches, null, 2), 'utf8');
        console.log("---");
        console.log(`✅ انتهى العمل. تم حفظ ${matches.length} مباراة في matches.json`);

    } catch (error) {
        console.error('❌ خطأ في السكربت الرئيسي:', error.message);
    }
}

scrapeMatches();
