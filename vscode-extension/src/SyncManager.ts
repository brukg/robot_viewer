/**
 * SyncManager - Handles bi-directional synchronization between
 * the 3D viewer and XML files (URDF/MJCF).
 *
 * Uses regex-based updates to preserve formatting and comments.
 * Based on the existing XMLUpdater pattern from the web app.
 */
export class SyncManager {
  /**
   * Update URDF joint limit attributes
   */
  updateURDFJointLimits(
    xmlContent: string,
    jointName: string,
    limits: {
      lower?: number;
      upper?: number;
      effort?: number;
      velocity?: number;
    }
  ): string {
    try {
      // Find joint definition
      const jointRegex = new RegExp(
        `<joint[^>]*name="${this.escapeRegex(jointName)}"[^>]*>([\\s\\S]*?)</joint>`,
        'g'
      );

      const match = jointRegex.exec(xmlContent);
      if (!match) {
        console.warn(`Joint not found: ${jointName}`);
        return xmlContent;
      }

      const jointContent = match[0];
      let updatedJointContent = jointContent;

      // Find limit tag
      const limitRegex = /<limit([^>]*)>/;
      const limitMatch = limitRegex.exec(jointContent);

      if (limitMatch) {
        // Limit tag exists, update attributes
        let limitTag = limitMatch[0];

        if (limits.lower !== undefined) {
          limitTag = this.updateAttribute(limitTag, 'lower', limits.lower);
        }
        if (limits.upper !== undefined) {
          limitTag = this.updateAttribute(limitTag, 'upper', limits.upper);
        }
        if (limits.effort !== undefined) {
          limitTag = this.updateAttribute(limitTag, 'effort', limits.effort);
        }
        if (limits.velocity !== undefined) {
          limitTag = this.updateAttribute(limitTag, 'velocity', limits.velocity);
        }

        updatedJointContent = jointContent.replace(limitRegex, limitTag);
      } else {
        // No limit tag, create one
        const attrs: string[] = [];
        if (limits.lower !== undefined) attrs.push(`lower="${limits.lower}"`);
        if (limits.upper !== undefined) attrs.push(`upper="${limits.upper}"`);
        if (limits.effort !== undefined) attrs.push(`effort="${limits.effort}"`);
        if (limits.velocity !== undefined) attrs.push(`velocity="${limits.velocity}"`);

        if (attrs.length > 0) {
          const limitTag = `    <limit ${attrs.join(' ')}/>`;
          updatedJointContent = jointContent.replace(
            '</joint>',
            `${limitTag}\n  </joint>`
          );
        }
      }

      return xmlContent.replace(jointContent, updatedJointContent);
    } catch (error) {
      console.error('Failed to update URDF joint limits:', error);
      return xmlContent;
    }
  }

  /**
   * Update MJCF joint properties
   */
  updateMJCFJoint(
    xmlContent: string,
    jointName: string,
    property: string,
    value: number
  ): string {
    try {
      // Find joint definition by name attribute
      const jointRegex = new RegExp(
        `<joint[^>]*name="${this.escapeRegex(jointName)}"[^>]*(?:/>|>[\\s\\S]*?</joint>)`,
        'g'
      );

      const match = jointRegex.exec(xmlContent);
      if (!match) {
        console.warn(`MJCF Joint not found: ${jointName}`);
        return xmlContent;
      }

      const jointTag = match[0];
      let updatedJointTag = jointTag;

      switch (property) {
        case 'position':
          // Position is typically not stored in MJCF as it's runtime state
          // However, we can update the ref attribute if present
          updatedJointTag = this.updateAttribute(jointTag, 'ref', value);
          break;

        case 'limit_lower':
        case 'limit_upper':
          // MJCF uses range="lower upper" format
          updatedJointTag = this.updateMJCFRange(
            jointTag,
            property === 'limit_lower' ? 'lower' : 'upper',
            value
          );
          break;

        case 'damping':
          updatedJointTag = this.updateAttribute(jointTag, 'damping', value);
          break;

        case 'stiffness':
          updatedJointTag = this.updateAttribute(jointTag, 'stiffness', value);
          break;
      }

      return xmlContent.replace(jointTag, updatedJointTag);
    } catch (error) {
      console.error('Failed to update MJCF joint:', error);
      return xmlContent;
    }
  }

  /**
   * Update MJCF range attribute (format: "lower upper")
   */
  private updateMJCFRange(
    tag: string,
    which: 'lower' | 'upper',
    value: number
  ): string {
    const rangeMatch = tag.match(/range="([^"]+)"/);

    if (rangeMatch) {
      const [lower, upper] = rangeMatch[1].split(/\s+/).map(parseFloat);
      const newLower = which === 'lower' ? value : lower;
      const newUpper = which === 'upper' ? value : upper;
      return tag.replace(
        /range="[^"]+"/,
        `range="${newLower} ${newUpper}"`
      );
    } else {
      // No range attribute, add one
      const defaultLower = which === 'lower' ? value : -3.14159;
      const defaultUpper = which === 'upper' ? value : 3.14159;
      return tag.replace(
        /<joint/,
        `<joint range="${defaultLower} ${defaultUpper}"`
      );
    }
  }

  /**
   * Update or add an attribute in an XML tag
   */
  private updateAttribute(
    tag: string,
    attrName: string,
    value: number | string
  ): string {
    const attrRegex = new RegExp(`${attrName}="[^"]*"`);

    if (attrRegex.test(tag)) {
      return tag.replace(attrRegex, `${attrName}="${value}"`);
    } else {
      // Add attribute before closing > or />
      if (tag.endsWith('/>')) {
        return tag.replace(/\/>$/, ` ${attrName}="${value}"/>`);
      } else if (tag.includes('>')) {
        return tag.replace(/>/, ` ${attrName}="${value}">`);
      }
    }
    return tag;
  }

  /**
   * Escape special regex characters in a string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Find the line number of a joint in the XML content
   */
  findJointLineNumber(xmlContent: string, jointName: string): number | null {
    const lines = xmlContent.split('\n');
    const jointPattern = new RegExp(
      `<joint[^>]*name="${this.escapeRegex(jointName)}"`,
      'i'
    );

    for (let i = 0; i < lines.length; i++) {
      if (jointPattern.test(lines[i])) {
        return i + 1; // 1-indexed line numbers
      }
    }
    return null;
  }

  /**
   * Batch update multiple joints
   */
  updateMultipleJointLimits(
    xmlContent: string,
    jointsLimits: Map<
      string,
      { lower?: number; upper?: number; effort?: number; velocity?: number }
    >
  ): string {
    let updatedXML = xmlContent;

    for (const [jointName, limits] of jointsLimits.entries()) {
      updatedXML = this.updateURDFJointLimits(updatedXML, jointName, limits);
    }

    return updatedXML;
  }
}
