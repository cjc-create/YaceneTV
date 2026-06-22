const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

// الموقع الجديد
const BASE_URL = 'https://kooraa-live-watch.panel001.com/'; 

/**
 * دالة لاستخراج الرابط المباشر m3u8 من المشغل
 */
async function getDirectStream(iframeUrl) {
    if (!iframeUrl) return "";
    
    const fullIframeUrl = iframeUrl.startsWith('//') ? `https:${iframeUrl}` : iframeUrl;

    try {
        const { data } = await axios.get(fullIframeUrl, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*'
            },
            timeout: 10000 
        });

        // 1. البحث عن روابط m3u8 الصريحة
        const m3u8Regex = /https?[:\/\w\.-]+\.m3u8[^\s"']*/gi;
        let matches = data.match(m3u8Regex);

        if (matches && matches.length > 0) {
            return matches[0].replace(/\\/g, ''); 
        }

        // 2. البحث عن الروابط داخل سمة "source" أو "file" في المشغل
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
 * فحص صفحة المباراة (تتبع التحويل وجلب الـ iframe)
 */
async function processMatchStream(matchUrl) {
    let result = { iframe: "", direct: "" };
    try {
        // maxRedirects: 5 لتتبع التحويل التلقائي من رابط اللوحة إلى رابط المدونة/المشغل
        const { data } = await axios.get(matchUrl, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
            },
            timeout: 10000,
            maxRedirects: 5 
        });
        
        const $ = cheerio.load(data);
        
        // جلب الـ iframe من الصفحة النهائية بعد التحويل
        const iframeSrc = $('iframe#match_frame').attr('src') || $('iframe').attr('src') || "";
        result.iframe = iframeSrc;

        if (iframeSrc) {
            result.direct = await getDirectStream(iframeSrc);
        }
    } catch (e) {
        console.log(`⚠️ فشل جلب صفحة المباراة أو تتبع التحويل: ${matchUrl}`);
    }
    return result;
}

/**
 * السكريبت الرئيسي لجمع المباريات
 */
async function scrapeMatches() {
    try {
        console.log("🚀 جاري فحص الموقع الجديد واستخراج بيانات المباريات...");
        const { data } = await axios.get(BASE_URL, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
            }
        });
        const $ = cheerio.load(data);
        const matches = [];

        // استهداف الكلاس العام للمباريات (التي بدأت والتي لم تبدأ بعد)
        const matchElements = $('.AY_Match');

        for (let i = 0; i < matchElements.length; i++) {
            const el = matchElements[i];
            
            // جلب رابط صفحة البث/المباراة
            const detailsUrl = $(el).find('a').attr('href') || "";
            
            // دالة استخراج الشعارات مع التعامل مع داتا الصور
            const getValidLogo = (sideSelector) => {
                const imgTag = $(el).find(`${sideSelector} .TM_Logo img`);
                let logoUrl = imgTag.attr('src') || imgTag.attr('data-src') || "";
                if (logoUrl.startsWith('//')) logoUrl = 'https:' + logoUrl;
                return logoUrl;
            };

            const match = {
                team1: $(el).find('.TM1 .TM_Name').text().trim(),
                team1Logo: getValidLogo('.TM1'),
                team2: $(el).find('.TM2 .TM_Name').text().trim(),
                team2Logo: getValidLogo('.TM2'),
                time: $(el).find('.MT_Time').text().trim(),
                status: $(el).find('.MT_Stat').text().trim(), // "مباشر" أو "لم تبدأ"
                league: $(el).find('.MT_Info ul li span').text().trim(),
                streamUrl: "", 
                stream: ""     
            };

            // إذا كانت المباراة جارية ولها رابط، نقوم بالدخول واستخراج البث
            if (detailsUrl && match.status === "مباشر") {
                console.log(`🔍 جاري استخراج البث لـ: ${match.team1} vs ${match.team2}`);
                const streamData = await processMatchStream(detailsUrl);
                
                match.streamUrl = streamData.iframe;
                match.stream = streamData.direct;
                
                if (match.stream) {
                    console.log(`✅ تم العثور على الرابط المباشر m3u8!`);
                } else {
                    console.log(`❌ لم يتم العثور على رابط مباشر داخل المشغل.`);
                }
            } else {
                console.log(`⏳ مباراة مؤجلة أو لم تبدأ بعد: ${match.team1} vs ${match.team2}`);
            }

            matches.push(match);
        }

        // حفظ البيانات في ملف JSON
        fs.writeFileSync('matches.json', JSON.stringify(matches, null, 2), 'utf8');
        console.log("---");
        console.log(`✅ انتهى العمل بنجاح. تم حفظ ${matches.length} مباراة في matches.json`);

    } catch (error) {
        console.error('❌ خطأ في السكربت الرئيسي:', error.message);
    }
}

scrapeMatches();
