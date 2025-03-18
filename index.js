const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// Cấu hình
const CONFIG = {
    baseUrl: 'https://drugbank.vn/danh-sach/co-so-phan-phoi',
    outputFile: 'data.json',
    backupDir: 'backups',
    startPage: 1,
    maxPages: 55,
    itemsPerPage: 20,
    delayBetweenItems: 1000,
    delayBetweenScroll: 500,
    retryAttempts: 3,
    retryDelay: 2000
};

// Hàm chính
async function scrapeDistributors() {
    console.log('Bắt đầu thu thập dữ liệu từ DrugBank...');
    
    // Tạo thư mục backup nếu chưa tồn tại
    if (!fs.existsSync(CONFIG.backupDir)) {
        fs.mkdirSync(CONFIG.backupDir, { recursive: true });
    }

    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--disable-features=site-per-process'] // Giúp tránh lỗi iframe
    });

    let page;
    
    try {
        page = await browser.newPage();
        
        // Tối ưu hiệu suất
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            // Chặn các request không cần thiết để tăng tốc độ
            const resourceType = request.resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                request.abort();
            } else {
                request.continue();
            }
        });

        // Khởi tạo file JSON nếu chưa tồn tại
        initializeJsonFile(CONFIG.outputFile);

        // Lưu trữ tổng số mục đã thu thập
        let totalCollectedItems = 0;
        let failedPages = [];

        // Bắt đầu thu thập từ trang đã chỉ định
        for (let currentPage = CONFIG.startPage; currentPage <= CONFIG.maxPages; currentPage++) {
            console.log(`\n--- Đang xử lý trang ${currentPage}/${CONFIG.maxPages} ---`);
            
            try {
                // Lấy dữ liệu cho trang hiện tại
                const pageData = await scrapePageData(page, currentPage);
                
                // Nếu không có dữ liệu, dừng lại
                if (pageData.length === 0) {
                    console.log(`Trang ${currentPage} không có dữ liệu, kết thúc quá trình.`);
                    break;
                }
                
                // Lưu dữ liệu vào file
                await saveDataToFile(CONFIG.outputFile, pageData, currentPage);
                
                // Cập nhật số lượng mục đã thu thập
                totalCollectedItems += pageData.length;
                console.log(`Đã thu thập ${pageData.length} mục từ trang ${currentPage}`);
                
                // Chờ ngẫu nhiên giữa các trang để tránh bị phát hiện là bot
                const randomDelay = Math.floor(Math.random() * 1000) + 1000;
                await delay(randomDelay);
            } catch (pageError) {
                console.error(`Lỗi khi xử lý trang ${currentPage}: ${pageError.message}`);
                failedPages.push(currentPage);
                
                // Tạo file backup riêng cho trang bị lỗi
                const backupPath = path.join(CONFIG.backupDir, `page_${currentPage}_error.json`);
                fs.writeFileSync(backupPath, JSON.stringify({ error: pageError.message }, null, 2), 'utf-8');
                
                // Chờ một thời gian trước khi tiếp tục trang tiếp theo
                await delay(CONFIG.retryDelay * 2);
            }
        }

        // Tổng kết kết quả
        console.log(`\n=== Kết thúc quá trình thu thập dữ liệu ===`);
        console.log(`Tổng số mục đã thu thập: ${totalCollectedItems}`);
        if (failedPages.length > 0) {
            console.log(`Các trang bị lỗi: ${failedPages.join(', ')}`);
        }
    } catch (error) {
        console.error("Lỗi nghiêm trọng trong quá trình thu thập dữ liệu:", error);
    } finally {
        // Đảm bảo trình duyệt luôn được đóng
        if (browser) {
            await browser.close();
            console.log("Đã đóng trình duyệt");
        }
    }
}

// Khởi tạo file JSON
function initializeJsonFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, '{}', 'utf-8');
            console.log(`Đã tạo file mới: ${filePath}`);
        } else {
            // Kiểm tra tính hợp lệ của file hiện có
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            if (!fileContent || fileContent.trim() === '') {
                fs.writeFileSync(filePath, '{}', 'utf-8');
                console.log(`File ${filePath} trống, đã khởi tạo lại.`);
            } else {
                try {
                    JSON.parse(fileContent);
                    console.log(`File ${filePath} đã tồn tại và hợp lệ.`);
                } catch (e) {
                    // Nếu file không phải JSON hợp lệ, tạo backup và khởi tạo lại
                    const backupPath = path.join(CONFIG.backupDir, `backup_${Date.now()}.json`);
                    fs.copyFileSync(filePath, backupPath);
                    fs.writeFileSync(filePath, '{}', 'utf-8');
                    console.log(`File ${filePath} không hợp lệ, đã sao lưu vào ${backupPath} và khởi tạo lại.`);
                }
            }
        }
    } catch (error) {
        console.error(`Lỗi khi khởi tạo file JSON: ${error.message}`);
    }
}

// Thu thập dữ liệu từ một trang
async function scrapePageData(page, pageNumber) {
    const pageData = [];
    
    try {
        // Truy cập trang danh sách với retry logic
        let retryCount = 0;
        let pageLoadSuccess = false;
        
        while (!pageLoadSuccess && retryCount < CONFIG.retryAttempts) {
            try {
                await page.goto(`${CONFIG.baseUrl}?page=${pageNumber}`, { 
                    waitUntil: 'networkidle2',
                    timeout: 30000 // Tăng timeout để xử lý mạng chậm
                });
                pageLoadSuccess = true;
            } catch (navigationError) {
                retryCount++;
                console.log(`Lỗi khi tải trang ${pageNumber}, thử lại lần ${retryCount}...`);
                await delay(CONFIG.retryDelay);
            }
        }
        
        if (!pageLoadSuccess) {
            throw new Error(`Không thể tải trang ${pageNumber} sau ${CONFIG.retryAttempts} lần thử.`);
        }
        
        // Lấy danh sách các nút chi tiết
        const detailButtons = await page.$$('tbody .btn-info');
        console.log(`Tìm thấy ${detailButtons.length} mục trên trang ${pageNumber}`);
        
        if (detailButtons.length === 0) {
            console.log(`Không tìm thấy dữ liệu trên trang ${pageNumber}`);
            return [];
        }
        
        const itemCount = Math.min(detailButtons.length, CONFIG.itemsPerPage);
        
        // Duyệt qua từng nút chi tiết
        for (let i = 0; i < itemCount; i++) {
            console.log(`Đang xử lý mục ${i + 1}/${itemCount} trên trang ${pageNumber}`);
            
            // Xử lý thử lại cho mỗi mục
            let itemRetries = 0;
            let itemData = null;
            
            while (!itemData && itemRetries < CONFIG.retryAttempts) {
                try {
                    itemData = await scrapeItemData(page, pageNumber, i);
                } catch (itemError) {
                    itemRetries++;
                    console.error(`Lỗi khi xử lý mục ${i + 1}, thử lại lần ${itemRetries}...`);
                    await delay(CONFIG.retryDelay);
                }
            }
            
            if (itemData) {
                pageData.push(itemData);
            }
            
            // Đợi giữa các mục để giảm tải cho máy chủ
            await delay(CONFIG.delayBetweenItems);
        }
    } catch (error) {
        console.error(`Lỗi khi thu thập dữ liệu từ trang ${pageNumber}: ${error.message}`);
        // Tạo file backup cho trang bị lỗi
        const backupPath = path.join(CONFIG.backupDir, `page_${pageNumber}_error_details.json`);
        fs.writeFileSync(backupPath, JSON.stringify({ error: error.message, stack: error.stack }, null, 2), 'utf-8');
    }
    
    return pageData;
}

// Thu thập dữ liệu chi tiết từ một mục
async function scrapeItemData(page, pageNumber, itemIndex) {
    // Truy cập lại trang danh sách nếu cần
    if (itemIndex > 0) {
        await page.goto(`${CONFIG.baseUrl}?page=${pageNumber}`, { waitUntil: 'networkidle2' });
        await delay(1000); // Đợi trang tải hoàn toàn
    }
    
    // Lấy lại các nút chi tiết
    const detailButtons = await page.$$('tbody .btn-info');
    if (itemIndex >= detailButtons.length) {
        console.log(`Không tìm thấy nút chi tiết cho mục ${itemIndex + 1}`);
        return null;
    }
    
    const detailButton = detailButtons[itemIndex];
    
    // Đảm bảo nút hiển thị trong viewport
    const isVisible = await page.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= window.innerHeight &&
            rect.right <= window.innerWidth
        );
    }, detailButton);
    
    if (!isVisible) {
        await page.evaluate(el => {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, detailButton);
        await delay(CONFIG.delayBetweenScroll);
    }
    
    // Click vào nút chi tiết với thử lại nếu cần
    let clickSuccess = false;
    let clickRetries = 0;
    
    while (!clickSuccess && clickRetries < CONFIG.retryAttempts) {
        try {
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
                detailButton.click()
            ]);
            clickSuccess = true;
        } catch (clickError) {
            clickRetries++;
            console.log(`Lỗi khi click vào mục ${itemIndex + 1}, thử lại lần ${clickRetries}...`);
            
            // Thử lại với cách khác nếu click thông thường không hoạt động
            if (clickRetries === 2) {
                try {
                    await page.evaluate(el => el.click(), detailButton);
                    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
                    clickSuccess = true;
                } catch (evalClickError) {
                    console.log(`Lỗi khi sử dụng evaluate click: ${evalClickError.message}`);
                }
            }
            
            await delay(CONFIG.retryDelay);
        }
    }
    
    if (!clickSuccess) {
        throw new Error(`Không thể click vào mục ${itemIndex + 1} sau ${CONFIG.retryAttempts} lần thử.`);
    }
    
    // Lấy URL và dữ liệu từ trang chi tiết
    const detailUrl = page.url();
    const listData = await extractListData(page);
    const tableData = await extractTableData(page);
    
    // Thêm thông tin trang và vị trí để dễ theo dõi
    return {
        'URL': detailUrl,
        'Trang': pageNumber,
        'STT': itemIndex + 1,
        'Thời gian thu thập': new Date().toISOString(),
        ...listData,
        ...tableData
    };
}

// Trích xuất dữ liệu từ danh sách
async function extractListData(page) {
    return page.evaluate(() => {
        const items = document.querySelectorAll('.list-unstyled li');
        const data = {};
        
        Array.from(items).forEach(li => {
            const titleEl = li.querySelector('h6 strong');
            const valueEl = li.querySelector('div');
            
            if (titleEl && valueEl) {
                const title = titleEl.innerText.trim();
                const value = valueEl.innerText.trim();
                if (title) {
                    data[title] = value;
                }
            }
        });
        
        return data;
    });
}

// Trích xuất dữ liệu từ bảng
async function extractTableData(page) {
    return page.evaluate(() => {
        const tables = document.querySelectorAll('table.table');
        const data = {};
        
        tables.forEach(table => {
            const rows = table.querySelectorAll('tr');
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 2) {
                    const key = cells[0].textContent.trim();
                    const value = cells[1].textContent.trim();
                    if (key) {
                        data[key] = value;
                    }
                }
            });
        });
        
        return data;
    });
}

// Lưu dữ liệu vào file
async function saveDataToFile(filePath, pageData, pageNumber) {
    return new Promise((resolve, reject) => {
        try {
            // Lưu bản sao của pageData trước tiên để tránh mất dữ liệu
            const backupPath = path.join(CONFIG.backupDir, `page_${pageNumber}_data.json`);
            fs.writeFileSync(backupPath, JSON.stringify(pageData, null, 2), 'utf-8');
            
            let allData = {};
            
            // Đọc và phân tích file hiện tại
            if (fs.existsSync(filePath)) {
                const fileContent = fs.readFileSync(filePath, 'utf-8');
                if (fileContent && fileContent.trim() !== '') {
                    try {
                        allData = JSON.parse(fileContent);
                    } catch (parseError) {
                        console.log(`File JSON không hợp lệ, tạo mới: ${parseError.message}`);
                        // Sao lưu file lỗi
                        const errorBackupPath = path.join(CONFIG.backupDir, `corrupt_data_${Date.now()}.json`);
                        fs.copyFileSync(filePath, errorBackupPath);
                        console.log(`Đã sao lưu file lỗi vào ${errorBackupPath}`);
                    }
                }
            }
            
            // Thêm dữ liệu mới vào
            allData[pageNumber] = pageData;
            
            // Ghi lại vào file theo cách an toàn
            // Đầu tiên ghi vào file tạm, sau đó đổi tên để đảm bảo nguyên tử
            const tempPath = `${filePath}.temp`;
            fs.writeFileSync(tempPath, JSON.stringify(allData, null, 2), 'utf-8');
            
            // Nếu tồn tại, xóa file cũ và đổi tên file tạm
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            fs.renameSync(tempPath, filePath);
            
            console.log(`Đã lưu dữ liệu trang ${pageNumber} vào ${filePath}`);
            resolve();
        } catch (error) {
            console.error(`Lỗi khi lưu dữ liệu trang ${pageNumber}: ${error.message}`);
            // Vẫn đảm bảo dữ liệu đã được lưu trong thư mục backup
            reject(error);
        }
    });
}

// Hàm delay promise
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Chạy hàm chính
scrapeDistributors().catch(console.error);