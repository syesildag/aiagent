import { Pool } from 'pg';
import { Logger } from './logger.js';

export interface ColumnInfo {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimary: boolean;
  hasDefault: boolean;
  isIdentity: boolean;
  isGenerated: boolean;
  columnNumber: number;
  maxLength?: number;
  precision?: number;
  scale?: number;
}

export interface ForeignKeyInfo {
  constraintName: string;
  columnName: string;
  referencedTable: string;
  referencedColumn: string;
  updateAction: string;
  deleteAction: string;
  isArray: boolean;
}

export interface TableInfo {
  tableName: string;
  schemaName: string;
  columns: ColumnInfo[];
  primaryKeys: string[];
  foreignKeys: ForeignKeyInfo[];
  indexes: IndexInfo[];
}

export interface IndexInfo {
  indexName: string;
  isUnique: boolean;
  columns: string[];
}

export interface RelationshipInfo {
  type: 'OneToOne' | 'OneToMany';
  propertyName: string;
  targetEntity: string;
  foreignKey: ForeignKeyInfo;
  isOwning: boolean; // true if this entity owns the foreign key
}

/**
 * PostgreSQL Database Metadata Extractor
 * 
 * This class provides comprehensive functionality to extract database schema metadata
 * from PostgreSQL system catalogs, specifically designed for entity generation.
 */
export class DbMetadataExtractor {
  private pool: Pool;
  private logger: Logger;

  constructor(pool: Pool, logger: Logger) {
    this.pool = pool;
    this.logger = logger;
  }

  /**
   * Extract complete table information including columns, constraints, and relationships
   */
  async extractTableInfo(tableName: string, schemaName: string = 'public'): Promise<TableInfo> {
    this.logger.info(`Extracting metadata for table: ${schemaName}.${tableName}`);

    const [columns, primaryKeys, foreignKeys, indexes] = await Promise.all([
      this.getTableColumns(tableName, schemaName),
      this.getPrimaryKeys(tableName, schemaName),
      this.getForeignKeys(tableName, schemaName),
      this.getIndexes(tableName, schemaName)
    ]);

    return {
      tableName,
      schemaName,
      columns,
      primaryKeys,
      foreignKeys,
      indexes
    };
  }

  /**
   * Get all columns for a table with their metadata
   */
  async getTableColumns(tableName: string, schemaName: string = 'public'): Promise<ColumnInfo[]> {
    const query = `
      SELECT 
        a.attname as column_name,
        pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
        NOT a.attnotnull as is_nullable,
        a.atthasdef as has_default,
        a.attidentity != '' as is_identity,
        a.attgenerated != '' as is_generated,
        a.attnum as column_number,
        CASE 
          WHEN a.atttypmod > 0 AND t.typname IN ('varchar', 'char', 'bpchar') 
          THEN a.atttypmod - 4
          ELSE NULL 
        END as max_length,
        CASE 
          WHEN t.typname = 'numeric' AND a.atttypmod > 0
          THEN (a.atttypmod - 4) >> 16
          ELSE NULL 
        END as precision,
        CASE 
          WHEN t.typname = 'numeric' AND a.atttypmod > 0
          THEN (a.atttypmod - 4) & 65535
          ELSE NULL 
        END as scale
      FROM pg_attribute a
      JOIN pg_class c ON a.attrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      JOIN pg_type t ON a.atttypid = t.oid
      WHERE c.relname = $1 
        AND n.nspname = $2
        AND a.attnum > 0 
        AND NOT a.attisdropped
      ORDER BY a.attnum;
    `;

    const result = await this.pool.query(query, [tableName, schemaName]);
    const primaryKeys = await this.getPrimaryKeys(tableName, schemaName);

    return result.rows.map(row => ({
      name: row.column_name,
      dataType: row.data_type,
      isNullable: row.is_nullable,
      isPrimary: primaryKeys.includes(row.column_name),
      hasDefault: row.has_default,
      isIdentity: row.is_identity,
      isGenerated: row.is_generated,
      columnNumber: row.column_number,
      maxLength: row.max_length,
      precision: row.precision,
      scale: row.scale
    }));
  }

  /**
   * Get primary key columns for a table
   */
  async getPrimaryKeys(tableName: string, schemaName: string = 'public'): Promise<string[]> {
    const query = `
      SELECT a.attname as column_name
      FROM pg_constraint con
      JOIN pg_class c ON con.conrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(con.conkey)
      WHERE c.relname = $1 
        AND n.nspname = $2
        AND con.contype = 'p'
      ORDER BY array_position(con.conkey, a.attnum);
    `;

    const result = await this.pool.query(query, [tableName, schemaName]);
    return result.rows.map(row => row.column_name);
  }

  /**
   * Get foreign key constraints for a table
   */
  async getForeignKeys(tableName: string, schemaName: string = 'public'): Promise<ForeignKeyInfo[]> {
    const query = `
      SELECT 
        con.conname as constraint_name,
        a.attname as column_name,
        ref_c.relname as referenced_table,
        ref_a.attname as referenced_column,
        CASE con.confupdtype
          WHEN 'a' THEN 'NO ACTION'
          WHEN 'r' THEN 'RESTRICT'
          WHEN 'c' THEN 'CASCADE'
          WHEN 'n' THEN 'SET NULL'
          WHEN 'd' THEN 'SET DEFAULT'
        END as update_action,
        CASE con.confdeltype
          WHEN 'a' THEN 'NO ACTION'
          WHEN 'r' THEN 'RESTRICT'
          WHEN 'c' THEN 'CASCADE'
          WHEN 'n' THEN 'SET NULL'
          WHEN 'd' THEN 'SET DEFAULT'
        END as delete_action,
        t.typname LIKE '%[]' as is_array
      FROM pg_constraint con
      JOIN pg_class c ON con.conrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      JOIN pg_class ref_c ON con.confrelid = ref_c.oid
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(con.conkey)
      JOIN pg_attribute ref_a ON ref_a.attrelid = ref_c.oid AND ref_a.attnum = ANY(con.confkey)
      JOIN pg_type t ON a.atttypid = t.oid
      WHERE c.relname = $1 
        AND n.nspname = $2
        AND con.contype = 'f'
      ORDER BY con.conname, array_position(con.conkey, a.attnum);
    `;

    const result = await this.pool.query(query, [tableName, schemaName]);
    return result.rows.map(row => ({
      constraintName: row.constraint_name,
      columnName: row.column_name,
      referencedTable: row.referenced_table,
      referencedColumn: row.referenced_column,
      updateAction: row.update_action,
      deleteAction: row.delete_action,
      isArray: row.is_array
    }));
  }

  /**
   * Get indexes for a table
   */
  async getIndexes(tableName: string, schemaName: string = 'public'): Promise<IndexInfo[]> {
    const query = `
      SELECT 
        i.relname as index_name,
        ix.indisunique as is_unique,
        array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) as columns
      FROM pg_index ix
      JOIN pg_class i ON ix.indexrelid = i.oid
      JOIN pg_class c ON ix.indrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(ix.indkey)
      WHERE c.relname = $1 
        AND n.nspname = $2
        AND ix.indisprimary = false
      GROUP BY i.relname, ix.indisunique
      ORDER BY i.relname;
    `;

    const result = await this.pool.query(query, [tableName, schemaName]);
    return result.rows.map(row => ({
      indexName: row.index_name,
      isUnique: row.is_unique,
      columns: row.columns
    }));
  }

  /**
   * Analyze relationships for a table and determine @OneToOne vs @OneToMany annotations
   */
  async analyzeRelationships(tableName: string, schemaName: string = 'public'): Promise<RelationshipInfo[]> {
    const relationships: RelationshipInfo[] = [];
    
    // Get foreign keys from this table (outgoing relationships)
    const outgoingFks = await this.getForeignKeys(tableName, schemaName);
    
    for (const fk of outgoingFks) {
      // Check if the foreign key column is unique (indicates OneToOne)
      const isUnique = await this.isColumnUnique(tableName, fk.columnName, schemaName);
      
      relationships.push({
        type: isUnique ? 'OneToOne' : 'OneToMany',
        propertyName: this.generatePropertyName(fk.referencedTable, isUnique),
        targetEntity: this.toPascalCase(fk.referencedTable),
        foreignKey: fk,
        isOwning: true
      });
    }

    // Get foreign keys pointing to this table (incoming relationships)
    const incomingFks = await this.getIncomingForeignKeys(tableName, schemaName);
    
    for (const fk of incomingFks) {
      // Check if the foreign key column is unique (indicates OneToOne)
      const isUnique = await this.isColumnUnique(fk.tableName, fk.columnName, schemaName);
      
      relationships.push({
        type: isUnique ? 'OneToOne' : 'OneToMany',
        propertyName: this.generatePropertyName(fk.tableName, isUnique),
        targetEntity: this.toPascalCase(fk.tableName),
        foreignKey: {
          constraintName: fk.constraintName,
          columnName: fk.columnName,
          referencedTable: tableName,
          referencedColumn: fk.referencedColumn,
          updateAction: fk.updateAction,
          deleteAction: fk.deleteAction,
          isArray: fk.isArray
        },
        isOwning: false
      });
    }

    return relationships;
  }

  /**
   * Get foreign keys that reference this table
   */
  async getIncomingForeignKeys(tableName: string, schemaName: string = 'public'): Promise<Array<ForeignKeyInfo & { tableName: string }>> {
    const query = `
      SELECT 
        con.conname as constraint_name,
        a.attname as column_name,
        c.relname as table_name,
        ref_a.attname as referenced_column,
        CASE con.confupdtype
          WHEN 'a' THEN 'NO ACTION'
          WHEN 'r' THEN 'RESTRICT'
          WHEN 'c' THEN 'CASCADE'
          WHEN 'n' THEN 'SET NULL'
          WHEN 'd' THEN 'SET DEFAULT'
        END as update_action,
        CASE con.confdeltype
          WHEN 'a' THEN 'NO ACTION'
          WHEN 'r' THEN 'RESTRICT'
          WHEN 'c' THEN 'CASCADE'
          WHEN 'n' THEN 'SET NULL'
          WHEN 'd' THEN 'SET DEFAULT'
        END as delete_action,
        t.typname LIKE '%[]' as is_array
      FROM pg_constraint con
      JOIN pg_class c ON con.conrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      JOIN pg_class ref_c ON con.confrelid = ref_c.oid
      JOIN pg_namespace ref_n ON ref_c.relnamespace = ref_n.oid
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(con.conkey)
      JOIN pg_attribute ref_a ON ref_a.attrelid = ref_c.oid AND ref_a.attnum = ANY(con.confkey)
      JOIN pg_type t ON a.atttypid = t.oid
      WHERE ref_c.relname = $1 
        AND ref_n.nspname = $2
        AND con.contype = 'f'
      ORDER BY con.conname, array_position(con.conkey, a.attnum);
    `;

    const result = await this.pool.query(query, [tableName, schemaName]);
    return result.rows.map(row => ({
      constraintName: row.constraint_name,
      columnName: row.column_name,
      tableName: row.table_name,
      referencedTable: tableName,
      referencedColumn: row.referenced_column,
      updateAction: row.update_action,
      deleteAction: row.delete_action,
      isArray: row.is_array
    }));
  }

  /**
   * Check if a column has a unique constraint
   */
  async isColumnUnique(tableName: string, columnName: string, schemaName: string = 'public'): Promise<boolean> {
    const query = `
      SELECT COUNT(*) > 0 as is_unique
      FROM pg_constraint con
      JOIN pg_class c ON con.conrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(con.conkey)
      WHERE c.relname = $1 
        AND n.nspname = $2
        AND a.attname = $3
        AND con.contype IN ('u', 'p')
        AND array_length(con.conkey, 1) = 1;
    `;

    const result = await this.pool.query(query, [tableName, schemaName, columnName]);
    return result.rows[0]?.is_unique || false;
  }

  /**
   * Check if a table exists
   */
  async tableExists(tableName: string, schemaName: string = 'public'): Promise<boolean> {
    const query = `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables 
        WHERE table_schema = $1 
        AND table_name = $2
      ) as exists;
    `;

    const result = await this.pool.query(query, [schemaName, tableName]);
    return result.rows[0]?.exists || false;
  }

  /**
   * Get all tables in a schema
   */
  async getTablesInSchema(schemaName: string = 'public'): Promise<string[]> {
    const query = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1
        AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `;

    const result = await this.pool.query(query, [schemaName]);
    return result.rows.map(row => row.table_name);
  }

  /**
   * Get PostgreSQL data type mapping to TypeScript types
   */
  mapPostgreSQLTypeToTypeScript(pgType: string): string {
    // Remove array notation for mapping, we'll handle arrays separately
    const baseType = pgType.replace('[]', '');
    const isArray = pgType.includes('[]');

    let tsType: string;

    // Map PostgreSQL types to TypeScript types
    switch (baseType.toLowerCase()) {
      case 'integer':
      case 'int':
      case 'int4':
      case 'smallint':
      case 'int2':
      case 'bigint':
      case 'int8':
      case 'serial':
      case 'bigserial':
      case 'smallserial':
      case 'numeric':
      case 'decimal':
      case 'real':
      case 'float4':
      case 'double precision':
      case 'float8':
        tsType = 'number';
        break;
      
      case 'character varying':
      case 'varchar':
      case 'character':
      case 'char':
      case 'text':
      case 'name':
        tsType = 'string';
        break;
      
      case 'boolean':
      case 'bool':
        tsType = 'boolean';
        break;
      
      case 'date':
      case 'timestamp':
      case 'timestamp without time zone':
      case 'timestamp with time zone':
      case 'timestamptz':
      case 'time':
      case 'time without time zone':
      case 'time with time zone':
      case 'timetz':
        tsType = 'Date';
        break;
      
      case 'json':
      case 'jsonb':
        tsType = 'any';
        break;
      
      case 'uuid':
        tsType = 'string';
        break;
      
      case 'bytea':
        tsType = 'Buffer';
        break;
      
      default:
        // For custom types or unknown types, use string as fallback
        tsType = 'string';
        this.logger.warn(`Unknown PostgreSQL type: ${baseType}, defaulting to string`);
    }

    // Handle arrays
    return isArray ? `${tsType}[]` : tsType;
  }

  /**
   * Generate property name for relationships
   */
  private generatePropertyName(targetTable: string, isUnique: boolean): string {
    const baseName = this.toCamelCase(targetTable);
    return isUnique ? baseName : `${baseName}s`;
  }

  /**
   * Convert string to PascalCase
   */
  private toPascalCase(str: string): string {
    return str
      .split(/[-_\s]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }

  /**
   * Convert string to camelCase
   */
  private toCamelCase(str: string): string {
    const pascalCase = this.toPascalCase(str);
    return pascalCase.charAt(0).toLowerCase() + pascalCase.slice(1);
  }
}