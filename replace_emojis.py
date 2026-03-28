#!/usr/bin/env python3
"""
Script para reemplazar emojis por componentes de iconos Lucide en archivos TSX
"""
import os
import re

# Mapeo de emojis a iconos Lucide
EMOJI_TO_ICON = {
    # Números y símbolos
    '💰': 'Wallet',
    '💵': 'DollarSign', 
    '💳': 'CreditCard',
    '💸': 'Banknote',
    
    # Objetos de oficina
    '📋': 'ClipboardList',
    '📊': 'BarChart3',
    '📈': 'TrendingUp',
    '📉': 'TrendingDown',
    '📁': 'Folder',
    '📄': 'FileText',
    '📝': 'Edit3',
    
    # Vehículos
    '🚗': 'Car',
    '🏍️': 'Bike',
    
    # Edificios y lugares
    '🏠': 'Home',
    '🏦': 'Building2',
    '🏛️': 'Landmark',
    '🔐': 'Lock',
    '🔒': 'Lock',
    '🔓': 'Unlock',
    
    # Acciones
    '✅': 'CheckCircle2',
    '❌': 'XCircle',
    '⚠️': 'AlertTriangle',
    '🔄': 'RefreshCw',
    '➕': 'Plus',
    '➖': 'Minus',
    '➡️': 'ArrowRight',
    '↩️': 'CornerUpLeft',
    '⏰': 'Clock',
    '🔍': 'Search',
    
    # Personas
    '👤': 'User',
    '👥': 'Users',
    
    # Otros
    '⚖️': 'Scale',
    '🛡️': 'Shield',
    '🔗': 'Link',
    '🔔': 'Bell',
    '📱': 'Smartphone',
    '🌅': 'Sunrise',
    '☀️': 'Sun',
    '🌙': 'Moon',
}

def find_emojis_in_file(filepath):
    """Encuentra todos los emojis en un archivo"""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    emojis_found = set()
    for emoji in EMOJI_TO_ICON.keys():
        if emoji in content:
            emojis_found.add(emoji)
    
    return emojis_found

def scan_directory(directory):
    """Escanea un directorio buscando archivos TSX con emojis"""
    results = {}
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith('.tsx'):
                filepath = os.path.join(root, file)
                emojis = find_emojis_in_file(filepath)
                if emojis:
                    results[filepath] = emojis
    return results

if __name__ == '__main__':
    frontend_dir = r'c:\Proyectos\SAAS-CDA\frontend\src'
    
    print("🔍 Escaneando archivos TSX...")
    results = scan_directory(frontend_dir)
    
    print(f"\n📊 Encontrados {len(results)} archivos con emojis:\n")
    
    for filepath, emojis in results.items():
        filename = os.path.basename(filepath)
        print(f"📄 {filename}:")
        for emoji in emojis:
            icon_name = EMOJI_TO_ICON.get(emoji, '???')
            print(f"   {emoji} → {icon_name}")
        print()
